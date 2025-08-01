import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { Anthropic } from "@anthropic-ai/sdk"

export class DifyHandler implements ApiHandler {
	private options: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		this.options = options
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const apiKey = this.options.difyApiKey
		const baseUrl = this.options.difyBaseUrl

		if (!apiKey || !baseUrl) {
			throw new Error("Dify API key and base URL are required")
		}

		// Convert messages to a single query string
		const query = this.convertMessagesToQuery(systemPrompt, messages)

		const requestBody = {
			inputs: {},
			query: query,
			response_mode: "streaming",
			conversation_id: "",
			user: "cline-user",
			files: [],
		}

		const response = await fetch(`${baseUrl}/v1/chat-messages`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(requestBody),
		})

		if (!response.ok) {
			throw new Error(`Dify API error: ${response.status} ${response.statusText}`)
		}

		if (!response.body) {
			throw new Error("No response body from Dify API")
		}

		const reader = response.body.getReader()
		const decoder = new TextDecoder()

		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				const chunk = decoder.decode(value, { stream: true })
				const lines = chunk.split("\n")

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = line.slice(6).trim()
						if (data === "[DONE]") {
							return
						}

						try {
							const parsed = JSON.parse(data)
							if (parsed.event === "message" && parsed.answer) {
								yield {
									type: "text",
									text: parsed.answer,
								}
							}
						} catch (e) {
							// Skip invalid JSON
							continue
						}
					}
				}
			}
		} finally {
			reader.releaseLock()
		}
	}

	private convertMessagesToQuery(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): string {
		let query = systemPrompt ? `System: ${systemPrompt}\n\n` : ""

		for (const message of messages) {
			if (typeof message.content === "string") {
				query += `${message.role}: ${message.content}\n`
			} else if (Array.isArray(message.content)) {
				for (const part of message.content) {
					if (part.type === "text") {
						query += `${message.role}: ${part.text}\n`
					}
				}
			}
		}

		return query.trim()
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: "dify-chat",
			info: {
				maxTokens: 8192,
				contextWindow: 128000,
				supportsImages: true,
				supportsPromptCache: false,
				inputPrice: 0,
				outputPrice: 0,
			},
		}
	}
}
