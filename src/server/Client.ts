import { WebSocket } from 'ws'
import { encode as encodeMsgPack, decode as decodeMsgPack } from 'msgpack-lite'
import { RequestVoiceListResult, SynthesisOptions, SynthesisSegmentEvent, SynthesizeSegmentsResult, VoiceListRequestOptions } from "../api/Synthesis.js"
import { SynthesizeSegmentsRequestMessage as SynthesiseSegmentsRequestMessage, SynthesizeSegmentsResponseMessage, SynthesisSegmentEventMessage, SynthesisSentenceEventMessage, VoiceListRequestMessage, WorkerRequestMessage, VoiceListResponseMessage } from './Worker.js'
import { getRandomHexString, logToStderr } from '../utilities/Utilities.js'
import { OpenPromise } from '../utilities/OpenPromise.js'

const log = logToStderr

export class Client {
	ws: WebSocket
	responseListeners = new Map<string, (message: string) => void>()

	constructor(ws: WebSocket) {
		this.ws = ws

		this.ws.on("message", (messageData, isBinary) => {
			if (!isBinary) {
				log(`Received an unexpected string WebSocket message: '${(messageData as Buffer).toString("utf-8")}'`)
				return
			}

			let incomingMessage: any

			try {
				incomingMessage = decodeMsgPack(messageData as Buffer)
			} catch (e) {
				log(`Failed to decode incoming message. Reason: ${e}`)
				return
			}

			this.onMessage(incomingMessage)
		})
	}

	async synthesizeSegments(segments: string[], options: SynthesisOptions, onSegment?: SynthesisSegmentEvent, onSentence?: SynthesisSegmentEvent): Promise<SynthesizeSegmentsResult> {
		const requestOpenPromise = new OpenPromise<SynthesizeSegmentsResult>()

		const request: SynthesiseSegmentsRequestMessage = {
			messageType: "SynthesizeSegmentsRequest",
			segments,
			options
		}

		function onResponse(responseMessage: SynthesizeSegmentsResponseMessage | SynthesisSegmentEventMessage | SynthesisSentenceEventMessage) {
			if (responseMessage.messageType == "SynthesizeSegmentsResponse") {
				requestOpenPromise.resolve(responseMessage)
			} else if (responseMessage.messageType == "SynthesisSegmentEvent" && onSegment) {
				onSegment(responseMessage)
			} else if (responseMessage.messageType == "SynthesisSentenceEvent" && onSentence) {
				onSentence(responseMessage)
			}
		}

		try {
			this.sendRequest(request, onResponse)
		} catch (e) {
			requestOpenPromise.reject(e)
		}

		return requestOpenPromise.promise
	}

	async requestVoiceList(options: VoiceListRequestOptions): Promise<RequestVoiceListResult> {
		const requestOpenPromise = new OpenPromise<RequestVoiceListResult>()

		const request: VoiceListRequestMessage = {
			messageType: "VoiceListRequest",
			options
		}

		function onResponse(responseMessage: VoiceListResponseMessage) {
			if (responseMessage.messageType == "VoiceListResponse") {
				requestOpenPromise.resolve(responseMessage)
			}
		}

		try {
			this.sendRequest(request, onResponse)
		} catch (e) {
			requestOpenPromise.reject(e)
		}

		return requestOpenPromise.promise
	}

	sendRequest(request: any, onResponse: (message: any) => void) {
		const requestId = getRandomHexString(16)
		request = { requestId, ...request }

		const encodedRequest = encodeMsgPack(request)

		this.ws.send(encodedRequest)

		this.responseListeners.set(requestId, onResponse)
	}

	onMessage(incomingMessage: any) {
		const requestId = incomingMessage.requestId

		if (!requestId) {
			log("Received a WebSocket message without a request ID")
			return
		}

		const listener = this.responseListeners.get(requestId)

		if (listener) {
			listener(incomingMessage)
		}
	}
}

export async function runClientTest(serverPort: number) {
	const ws = new WebSocket(`ws://localhost:${serverPort}`)

	ws.on("open", async () => {
		const client = new Client(ws)

		const voiceListResult = await client.requestVoiceList({
			engine: "pico"
		})

		log(voiceListResult)

		client.synthesizeSegments(
			["Hello world! How are you?", "Want to play a game?"],
			{},
			async () => {
				log("onSegment (call 1)")
			},
			async () => {
				log("onSentence (call 1)")
			})

		//log(synthesisResult1)

		client.synthesizeSegments(
			["Hey! What's up?", "See ya."],
			{},
			async () => {
				log("onSegment (call 2)")
			},
			async () => {
				log("onSentence (call 2)")
			})

		//log(synthesisResult2)

		//ws.close()
	})
}
