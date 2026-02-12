export function extractProjectKey(issueKey) {
    if (!issueKey || typeof issueKey !== 'string') {
        return null;
    }

    // Match JIRA issue key pattern, e.g., "PROJ-123"

    const match = issueKey.match(/^([A-Z][A-Z0-9]+)-/i);
    return match ? match[1].toUpperCase() : null;
}

export async function findOrCreateProject(projectKey, userEmail) {
    const Project = (await import('../models/Project.js')).default;

    if (!projectKey) {
        throw new Error('Project key is required to find or create a project.');
    }

    // Normalize to uppercase and trim whitespace
    const normalizedKey = projectKey.trim().toUpperCase();

    // Find existing project
    let project = await Project.findOne({ projectKey: normalizedKey });

    // If not found, create a new one
    if(!project){
        project = new Project({
            projectKey: normalizedKey,
            createdBy: userEmail,
            firstGeneratedAt: new Date(),
            lastGeneratedAt: new Date(),
            totalGenerations: 0
        });
        await project.save();
    } else {
        // Update lastGeneratedAt timestamp
        project.lastGeneratedAt = new Date();
        await project.save();
    }

    return project;
}