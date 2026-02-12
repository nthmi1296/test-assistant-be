import { compare } from "bcryptjs";
import mongoose from "mongoose";

/**
 * SUB - SCHEMAS
 */

// Markdown schema
const markdownSchema = new mongoose.Schema({
    content: { type: String, required: true },
    filename: { type: String, required: true },
}, {_id: false });

// JIRA ticket schema
const jiraTicketSchema = new mongoose.Schema({
    issueURL: { type: String},
    issueType: { type: String },
    createdAt: { type: Date },
}, {_id: false });

// PDF attachment schema
const pdfAttachmentSchema = new mongoose.Schema({
    attachmentId: {type:String},
    filename: { type: String },
    attachedAt: { type: Date },
    commentId: { type: String },
}, {_id: false });

// Version schema
const versionSchema = new mongoose.Schema({
    versionNumber: { type: String, required: true },
    content: { type: String, required: true },
    releaseDate: { type: Date, default: Date.now },
    updatedBy: { type: String, required: true },
    notes: { type: String },
}, {_id: false });

/**
 * MAIN SCHEMA - GENERATION SCHEMA
 */

const generationSchema = new mongoose.Schema({
    issueKey: { type: String, index: true },
    email: { type: String, index: true },
    project: {
        type: mongoose.Schema.Types.ObjectId,
        refer: 'Project',
        index: true
    },
    mode: { type: String, enum: ['manual', 'auto']},
    status: { type: String, enum: ['completed', 'failed']},
    createdAt: { type: Date, default: Date.now },
    startedAt: { type: Date },
    completedAt: { type: Date },
    generationTimeSeconds: { type: Number },
    cost: { type: Number },
    tokenUsage: {
        promptTokens: { type: Number },
        completionTokens: { type: Number },
        totalTokens: { type: Number },
    },
    result: {
        markdown: { type: markdownSchema },
    },
    jiraTickets: [jiraTicketSchema],
    pdfAttachments: [pdfAttachmentSchema],
    error: { type: String },
    published: { type: Boolean, default: false, index: true },
    publishedAt: { type: Date },
    publishedBy: { type: String }, // email of the user who published
    versions: [versionSchema],
    currentVersion: { type: Number, default: 1 },
}, { timestamps: true });

export default mongoose.model('Generation', generationSchema);