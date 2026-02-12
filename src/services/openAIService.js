import dotenv from 'dotenv';
dotenv.config();
import OpenAI from 'openai';
import { logger } from '../utils/logger.js';

const MANUAL_PROMPT = `You are an expert manual QA Engineer. Generate comprehensive test cases from JIRA issue descriptions.

**Context:** You will receive JIRA issue details including title, description, comments, and acceptance criteria. Use ONLY this information - never invent requirements.

**Output Requirements:**
1. Use proper markdown with ## for main headings and - for bullet points
2. Include a title: "# Test Cases for [JIRA-ID]: [Issue Title]"
3. Structure by categories: ## **Functional Requirements**, ## **UI & Visual Validation**, ## **Edge Cases**, ## **Data Integrity** (if applicable)
4. Include blank lines before and after lists
5. Each test case should be:
   - Clear and actionable
   - Cover specific acceptance criteria
   - Include preconditions, steps, and expected results
   - Prioritized (High/Medium/Low)

**Must NOT:**
- Never mention specific individual names
- Never include implementation details (HTML classes, functions)
- Never invent requirements not in the JIRA issue

**Coverage:**
- Positive and negative test cases
- Edge cases and boundary conditions
- Error handling
- User workflows
- Form validations
- State transitions
- Accessibility considerations (if UI-related)

Generate comprehensive test cases now.`;


export default class OpenAIService {

  constructor(){
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey){
      throw new Error('OPENAI_API_KEY must be set in environment variables');
    }

    this.client = new OpenAI({
      apiKey: apiKey
    });
    this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    this.maxCompletionTokens = 8000;
    this.maxRetries = 3;
  }

  async generateTestCases(context, issueKey, autoMode = false, image = []) {
    try {
      const systemPrompt = autoMode ? AUTO_PROMPT : MANUAL_PROMPT;

      // Build user message content
      const issueContext = `\n\n### JIRA Issue: ${issueKey}\n\n${context}`;
      const messages = [
        { role: 'system', content: systemPrompt },
      ]
      
      let userMessage = {
        role: 'user',
        content: issueContext
      };
      messages.push(userMessage);

      // Retry logic
      let retryCount = 0;
      let lastError;

      while (retryCount < this.maxRetries) {
        try {
          logger.info(`Calling OpenAI API (attempt ${retryCount +1}/${this.maxRetries})`);

          const response = await this.client.chat.completions.create({
            model: this.model,
            messages: messages,
            max_completion_tokens: this.maxCompletionTokens,
            temperature: 0.7,
          });
          const content = response.choices[0]?.message?.content || '';
          if (!content) {
            throw new Error('Empty response from OpenAI');
          }
          logger.info(`OpenAI API generation successfully (${response.usage?.total_tokens || 0} tokens used)`);

          // Get real token usage
          const usage = response.usage || {};
          const tokenUsage = {
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0,
          }

          // Calculate cost based on model pricing (gpt-4o-mini: $0.15 per 1M input tokens, $0.60 per 1M output tokens)
          const inputCost = (tokenUsage.promptTokens / 1_000_000) * 0.15;
          const outputCost = (tokenUsage.completionTokens / 1_000_000) * 0.60;
          const totalCost = inputCost + outputCost;

          logger.info(`OpenAI API cost estimation: $${totalCost.toFixed(4)}`);
          return { content, tokenUsage, cost: totalCost  };
        } catch (error) {
          lastError = error;
          retryCount++;
          if(retryCount === this.maxRetries){
            logger.error(`OpenAI API generation failed after ${this.maxRetries} attempts: ${error.message}`);
            throw error;
          }
        }
        throw lastError || new Error('OpenAI generation failed');
      }

    } catch (error) {
      logger.error(`Generation error for ${issueKey}: ${error.message}`);
      throw error;
    }

  }
}
