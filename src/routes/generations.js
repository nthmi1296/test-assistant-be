import { Router } from "express";
import JiraService from "../services/jiraService.js";
import OpenAIService from "../services/openAIService.js";
import { requireAuth } from "../middleware/auth.js";
import { get } from "mongoose";
import { logger } from "../utils/logger.js";
import {
    extractProjectKey,
    findOrCreateProject,
} from "../utils/projectUtils.js";
import Generation from "../models/Generation.js";
import { format } from "morgan";

const router = Router();
let jiraService = null;

// // Lazy initialize JIRA service
export function getJiraService() {
    if (!jiraService) {
        try {
            jiraService = new JiraService();
        } catch (error) {
            console.error("Failed to initialize JiraService:", error);
            throw error;
        }
    }
    return jiraService;
}

// Lazy initialize OpenAI service
let openaiService = null;
function getOpenAIService() {
    if (!openaiService) {
        try {
            openaiService = new OpenAIService();
        } catch (error) {
            throw new Error(
                "OpenAI service not configured. Please set OPENAI_API_KEY in .env",
            );
        }
    }
    return openaiService;
}

// Get all generations with pagination and filtering
router.get('/', requireAuth, async (req, res, next) => {
  try {
    // Parse pagination parameters
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '10', 10)));
    const skip = (page - 1) * limit;

    // Parse filter type: 'all', 'mine', 'published'
    const filterType = req.query.filter || 'all';
    
    let filter = {};
    
    if (filterType === 'mine') {
      // Only user's own generations
      filter = { email: req.user.email };
    } else if (filterType === 'published') {
      // Only published generations
      filter = { published: true, status: 'completed' };
    } else {
      // Default: user's own OR published ones from all users
      filter = {
        $or: [
          { email: req.user.email },
          { published: true, status: 'completed' }
        ]
      };
    }

    // Fetch generations with pagination
    const [generations, total] = await Promise.all([
      Generation.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Generation.countDocuments(filter)
    ]);

    // Calculate total pages
    const pages = Math.ceil(total / limit);

    return res.json({ 
      success: true, 
      data: { 
        generations,
        pagination: {
          page,
          limit,
          total,
          pages
        }
      } 
    });
  } catch (e) { 
    next(e); 
  }
});

router.post("/prelight", requireAuth, async (req, res, next) => {
    const { issueKey } = req.body;

    if (!issueKey) {
        return res
            .status(400)
            .json({ success: false, error: "issueKey is required" });
    }

    // Fetch issue from JIRA
    const jira = getJiraService();
    try {
        const issueResult = await jira.getIssue(issueKey);
        if (!issueResult.success) {
            // Return appropriate status code based on error type
            const statusCode =
                issueResult.error.includes("authentication") ||
                issueResult.error.includes("forbidden")
                    ? 403
                    : issueResult.error.includes("not found")
                      ? 404
                      : 500;
            return res.status(statusCode).json({
                success: false,
                error: issueResult.error || "Failed to fetch issue from JIRA",
            });
        }

        const issue = issueResult.issue;
        const fields = issue.fields || {};
        const summary = fields.summary || "";
        const description = jira.extractTextFromADF(fields.description) || "";
        logger.info(`Issue ${issueKey} description ${description}`);

        // Count attachments
        const attachments = fields.attachment || [];
        const attachmentImages = attachments.filter(
            (att) => att.mimeType && att.mimeType.startsWith("image/"),
        );

        // Estimate tokens
        const contextText = `${summary}\n\n${description}`;
        const contextCharacters = contextText.length;
        const estimatedTokens =
            Math.ceil(contextCharacters / 4) + attachmentImages.length * 200; // Rough estimate: 1 token ~ 4 characters and 200 tokens per image

        // Estimate cost (gpt-4o-mini pricing: $0.15 per 1M input tokens, $0.60 per 1M output tokens)
        const estimatedCost =
            (estimatedTokens / 1000000) * 0.15 + (8000 / 1000000) * 0.6; // Assume ~ 8K output tokens

        // Return prelight analysis
        logger.info({
            isUiStory: true, // Default to true for now
            issueKey,
            title: summary,
            description,
            estimatedTokens,
            estimatedCost: estimatedCost.toFixed(4),
        });
        return res.json({
            isUiStory: true, // Default to true for now
            issueKey,
            title: summary || "N/A",
            description,
            attachments: attachments.length,
            estimatedTokens,
            estimatedCost: estimatedCost.toFixed(4), // Return cost rounded to 6 decimal places
        });
    } catch (error) {
        return next(error);
    }
});

router.post("/testcases", requireAuth, async (req, res, next) => {
    try {
        const { issueKey, autoMode = false } = req.body || {};
        if (!issueKey) {
            return res
                .status(400)
                .json({ success: false, error: "issueKey is required" });
        }

        const projectKey = extractProjectKey(issueKey);
        let project = null;

        if (projectKey) {
            try {
                project = findOrCreateProject(projectKey, req.user.email);
                logger.info(
                    `Associated generation with project: ${projectKey}`,
                );
            } catch (error) {
                logger.warn(`Failed to fetch project ${projectKey}: ${error}`);
            }
        }

        // Create generation document
        const generation = new Generation({
            issueKey,
            email: req.user.email,
            project: project ? project._id : null,
            mode: "manual",
            startedAt: new Date(),
        });
        await generation.save();

        // Update project stats
        if (project) {
            const Project = (await import("../models/Project.js")).default;
            const updatedProject = await Project.findById(project._id);
            if (updatedProject) {
                updatedProject.totalGenerations =
                    await Generation.countDocuments({ project: project._id });
                await updatedProject.save();
            }
        }
        // Keep track of start time
        const startTime = Date.now();

        // Start fetching jira generation
        const jira = getJiraService();
        const issueResult = await jira.getIssue(issueKey);

        if (!issueResult.success) {
            generation.status = "failed";
            generation.error =
                issueResult.error || "Failed to fetch issue from JIRA";
            generation.completedAt = new Date();
            await generation.save();
            return res
                .status(404)
                .json({ success: false, error: issueResult.error });
        }
        const issue = issueResult.issue;
        const fields = issue.fields || {};
        const summary = fields.summary || "";
        const description = jira.extractTextFromADF(fields.description) || "";
        const context = "Title: " + summary + "\n\nDescription: " + description;

        let markdownContent = `# Test Cases for ${issueKey}\n\n`;
        let tokenUsage = null;
        let cost = null;

        try {
            const openai = getOpenAIService();
            logger.info(
                `Generating test cases for issue ${issueKey} using OpenAI (mode: ${autoMode ? "auto" : "manual"})`,
            );
            const result = await openai.generateTestCases(
                context,
                issueKey,
                autoMode,
                [],
            );
            if (typeof result === "string") {
                markdownContent = result;
            } else {
                markdownContent = result.content;
                tokenUsage = result.tokenUsage;
                cost = result.cost;
            }

            // Ensure we have proper title
            if (!markdownContent.startsWith("#")) {
                markdownContent = `# Test Cases for ${issueKey}: ${summary || "Untitled"}\n\n${markdownContent}`;
            }
        } catch (error) {
            logger.error(`OpenAI generation failed: ${error.message}`);
            generation.status = "failed";
            generation.error = `OpenAI generation failed: ${error.message}`;
            generation.completedAt = new Date();
            await generation.save();
            return res.status(500).json({
                success: false,
                error: error.message || "Failed to generate test cases",
            });
        }

        // Calculate generation duration
        const generationTimeSeconds = (Date.now() - startTime) / 1000;

        // Update generation document
        generation.status = "completed";
        generation.completedAt = new Date();
        generation.generationTimeSeconds =
            Math.round(generationTimeSeconds * 100) / 100;
        generation.cost = cost;
        generation.tokenUsage = tokenUsage;
        generation.result = {
            markdown: {
                filename: `${issueKey}_testcases_${generation._id}.md`,
                content: markdownContent,
            },
        };
        generation.currentVersion = 1;
        generation.versions = [];

        await generation.save();
        logger.info(
            `Generation ${generation._id} for issue ${issueKey} markdown ${generation.result.markdown} completed in ${generation.generationTimeSeconds} seconds, cost: $${generation.cost?.toFixed(4)}`,
        );

        // Return response
        return res.json({
            success: true,
            data: {
                generationId: generation._id,
                issueKey,
                markdown: generation.result.markdown,
                generationTimeSeconds: generation.generationTimeSeconds,
                cost: generation.cost,
            },
        });
    } catch (error) {
        return next(error);
    }
});

router.get("/:id/view", requireAuth, async (req, res, next) => {
    try {
        const gen = await Generation.findById(req.params.id);
        if (!gen) {
            return res
                .status(404)
                .json({ success: false, error: "Generation not found!" });
        }

        // Check ownership and allow if published and completed
        const isOwner = gen.email === req.user.email;
        const isPublishedAndCompleted =
            gen.published && gen.status === "completed";

        // debug info
        logger.info(
            `View request for generation ${req.params.id} by user ${req.user.email}. isOwner: ${isOwner}, isPublishedAndCompleted: ${isPublishedAndCompleted}`,
        );
        logger.info(
            `Generation details: published=${gen.published}, status=${gen.status}, email=${gen.email}`,
        );

        // If not owner completed, deny access
        if (!isOwner && !isPublishedAndCompleted) {
            return res
                .status(404)
                .json({ success: false, error: "Not found!" });
        }

        // Only allow viewing completed generations
        if (gen.status !== "completed") {
            return res.status(400).json({
                success: false,
                error: "Generation not completed yet",
            });
        }

        // Get latest version
        const latestVersion =
            gen.versions && gen.versions.length > 0
                ? gen.versions[gen.versions.length - 1]
                : null;

        const projectKey = gen.issueKey
            ? extractProjectKey(gen.issueKey)
            : null;
        return res.json({
            success: true,
            data: {
                email: gen.email,
                content: gen.result?.markdown?.content || "",
                filename: gen.result?.markdown?.filename || "output.md",
                format: "markdown",

                // Metadata for header
                issueKey: gen.issueKey,
                projectKey: projectKey,
                updatedAt: gen.updatedAt,

                // Existing fields
                published: gen.published || false,
                publishedAt: gen.publishedAt,
                publishedBy: gen.publishedBy,
                currentVersion: gen.currentVersion,
                versions: gen.versions || [],
                lastUpdatedBy: latestVersion?.updatedBy || gen.email,
                lastUpdatedAt:
                    latestVersion?.updatedAt || gen.updatedAt || gen.createdAt,
            },
        });
    } catch (error) {
        return next(error);
    }
});

router.put("/:id/content", requireAuth, async (req, res, next) => {
    try {
        const { content } = req.body || {};
        if (typeof content !== "string" || content.trim() === "") {
            return res
                .status(400)
                .json({ success: false, error: "Content is required!" });
        }
        const gen = await Generation.findById(req.params.id);
        if (!gen || gen.email !== req.user.email) {
            return res
                .status(404)
                .json({ success: false, error: "Generation not found!" });
        }

        // Only allow updating completed generations
        if (gen.status !== "completed") {
            return res.status(400).json({
                success: false,
                error: "Only completed generations can be updated!",
            });
        }

        // Track version: save current content as a version before updating
        const currentContent = gen.result?.markdown?.content || "";
        if (currentContent && currentContent !== content) {
            // Initialize versions array if not present
            if (!gen.versions) {
                gen.versions = [];
            }

            // Get the current version number (default to 1 if not set)
            const currentVersionNumber = gen.currentVersion || 1;

            // Save the current content as a new version (only if we haven't already saved this version)
            const versionExists = gen.versions.some(
                (v) => v.versionNumber === currentVersionNumber,
            );
            if (!versionExists) {
                gen.versions.push({
                    versionNumber: currentVersionNumber,
                    content: currentContent,
                    updatedBy: req.user.email,
                    updatedAt: new Date(),
                });
                logger.info(
                    `Saved version ${currentVersionNumber} to versions array for generation ${req.params.id}`,
                );
            }

            // Increment current version number
            gen.currentVersion = currentVersionNumber + 1;

            logger.info(
                `Updating generation ${req.params.id} to version ${gen.currentVersion}`,
            );
        }
        // Update markdown content
        if (!gen.result) {
            gen.result = {};
        }
        if (!gen.result.markdown) {
            gen.result.markdown = {};
        }
        gen.result.markdown.content = content;
        await gen.save();

        logger.info(
            `Generation ${req.params.id} content updated by ${req.user.email}`,
        );

        return res.json({
            success: true,
            data: {
                content: gen.result.markdown.content,
                currentVersion: gen.currentVersion || 1,
            },
        });
    } catch (error) {
        return next(error);
    }
});

router.put("/:id/publish", requireAuth, async (req, res, next) => {
    try {
        const { published } = req.body;
        if (typeof published !== "boolean") {
            return res.status(400).json({
                success: false,
                error: "Published status must be a boolean!",
            });
        }

        const gen = await Generation.findById(req.params.id);
        if (!gen || gen.email !== req.user.email) {
            return res
                .status(404)
                .json({ success: false, error: "Generation not found!" });
        }

        // Only allow publishing completed generations
        if (gen.status !== "completed") {
            return res.status(400).json({
                success: false,
                error: "Only completed generations can be published!",
            });
        }
        // Update published status
        gen.published = published;
        if (published) {
            gen.publishedAt = new Date();
            gen.publishedBy = req.user.email;
            logger.info(
                `Generation ${req.params.id} published by ${req.user.email}`,
            );
        } else {
            gen.publishedAt = undefined;
            gen.publishedBy = undefined;
            logger.info(
                `Generation ${req.params.id} unpublished by ${req.user.email}`,
            );
        }
        await gen.save();
        return res.json({
            success: true,
            data: {
                published: gen.published,
                publishedAt: gen.publishedAt,
                publishedBy: gen.publishedBy,
            },
        });
    } catch (error) {
        return next(error);
    }
});

// Download (allow downloading if it's user's own or published)
router.get("/:id/download", requireAuth, async (req, res, next) => {
    try {
        const gen = await Generation.findById(req.params.id);
        if (!gen)
            return res.status(404).json({ success: false, error: "Not found" });

        // Check if user has permission to download
        // Allow if it's user's own OR if it's published and completed
        const isOwner = gen.email === req.user.email;
        const isPublishedAndCompleted =
            gen.published && gen.status === "completed";

        if (!isOwner && !isPublishedAndCompleted) {
            return res.status(404).json({ success: false, error: "Not found" });
        }

        if (gen.status !== "completed") {
            return res
                .status(400)
                .json({ success: false, error: "Not completed" });
        }

        // Set headers for file download
        res.setHeader("Content-Type", "text/markdown");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${gen.result?.markdown?.filename || "output.md"}"`,
        );

        // Send the markdown content
        return res.send(gen.result?.markdown?.content || "");
    } catch (err) {
        next(err);
    }
});

// Delete generation (only owner can delete)
router.delete("/:id", requireAuth, async (req, res, next) => {
    try {
        const gen = await Generation.findById(req.params.id);
        if (!gen) {
            return res
                .status(404)
                .json({ success: false, error: "Generation not found" });
        }

        // Only the owner can delete their generation
        if (gen.email !== req.user.email) {
            return res
                .status(403)
                .json({
                    success: false,
                    error: "You can only delete your own generations",
                });
        }

        // Check if it's published - warn but allow deletion
        if (gen.published) {
            logger.warn(
                `User ${req.user.email} is deleting published generation ${req.params.id}`,
            );
        }

        // Delete the generation
        await Generation.findByIdAndDelete(req.params.id);

        logger.info(`Generation ${req.params.id} deleted by ${req.user.email}`);
        return res.json({
            success: true,
            message: "Generation deleted successfully",
        });
    } catch (error) {
        return next(error);
    }
});

export default router;
