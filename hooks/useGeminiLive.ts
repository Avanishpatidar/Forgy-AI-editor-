import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration, Tool, Blob } from '@google/genai';
import { createBlob, decode, decodeAudioData } from '../services/geminiService';

const getAiClient = (): GoogleGenAI => {
    const API_KEY = process.env.API_KEY;
    if (!API_KEY) throw new Error("API_KEY environment variable is not set");
    return new GoogleGenAI({ apiKey: API_KEY });
};

const editImageFunctionDeclaration: FunctionDeclaration = {
  name: 'editImage',
  description: 'Edits the image. Use this for requests like "add a hat", "change color", "remove object".',
  parameters: {
    type: Type.OBJECT,
    properties: { prompt: { type: Type.STRING } },
    required: ['prompt'],
  },
};

const tools: Tool[] = [{ functionDeclarations: [editImageFunctionDeclaration] }];

interface GeminiLiveHookProps {
    onFunctionCall: (name: string, args: any) => Promise<any>;
    onTurnComplete: (user: string, ai: string) => void;
    onInterimTranscript: (transcript: string) => void;
    onAiSpeakingStatusChange: (isSpeaking: boolean) => void;
}

export const useGeminiLive = ({ onFunctionCall, onTurnComplete, onInterimTranscript, onAiSpeakingStatusChange }: GeminiLiveHookProps) => {
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const sessionPromiseRef = useRef<ReturnType<InstanceType<typeof GoogleGenAI>['live']['connect']> | null>(null);
  const audioContextRefs = useRef<{ input: AudioContext | null, output: AudioContext | null }>({ input: null, output: null });
  const streamRef = useRef<MediaStream | null>(null);
  const audioNodesRef = useRef<{ source: MediaStreamAudioSourceNode | null, processor: ScriptProcessorNode | null }>({ source: null, processor: null });
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');

  const stopSession = useCallback(async () => {
    if (sessionPromiseRef.current) {
        try { const session = await sessionPromiseRef.current; session.close(); } catch (e) {}
        sessionPromiseRef.current = null;
    }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (audioNodesRef.current.source) { audioNodesRef.current.source.disconnect(); audioNodesRef.current.source = null; }
    if (audioNodesRef.current.processor) { audioNodesRef.current.processor.disconnect(); audioNodesRef.current.processor = null; }
    if (audioContextRefs.current.input) { audioContextRefs.current.input.close(); audioContextRefs.current.input = null; }
    if (audioContextRefs.current.output) { audioContextRefs.current.output.close(); audioContextRefs.current.output = null; }
    
    audioSourcesRef.current.forEach(s => s.stop());
    audioSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    onInterimTranscript('');
    setIsLive(false);
  }, [onInterimTranscript]);

  const startSession = useCallback(async (currentImageBase64?: string) => {
    if (isLive) return;
    setError(null);
    currentInputTranscriptionRef.current = '';
    currentOutputTranscriptionRef.current = '';
    
    try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContextRefs.current.input = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        audioContextRefs.current.output = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        
        const ai = getAiClient();
        const sessionPromise = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' }}},
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                tools: tools,
                // Updated system instruction to be more patient
                systemInstruction: "You are Forgy, a professional but cool AI editor. You see the image the user has uploaded. LISTEN to the user completely. Do not interrupt. Wait for a specific command to edit the image before suggesting things. If the user just says hello, say hello back briefly. Only use the editImage tool when explicitly asked.",
            },
            callbacks: {
                onopen: () => {
                    setIsLive(true);
                    if (!audioContextRefs.current.input || !streamRef.current) return;
                    
                    // Send initial image context immediately so the model sees what we see
                    if (currentImageBase64) {
                         sessionPromise.then(s => s.sendRealtimeInput({ 
                            media: { 
                                mimeType: 'image/jpeg', 
                                data: currentImageBase64.split(',')[1] 
                            } 
                        }));
                    }

                    audioNodesRef.current.source = audioContextRefs.current.input.createMediaStreamSource(streamRef.current);
                    audioNodesRef.current.processor = audioContextRefs.current.input.createScriptProcessor(4096, 1, 1);
                    audioNodesRef.current.processor.onaudioprocess = (e) => {
                        sessionPromise.then(s => s.sendRealtimeInput({ media: createBlob(e.inputBuffer.getChannelData(0)) }));
                    };
                    audioNodesRef.current.source.connect(audioNodesRef.current.processor);
                    audioNodesRef.current.processor.connect(audioContextRefs.current.input.destination);
                },
                onmessage: async (msg: LiveServerMessage) => {
                    if (msg.serverContent?.inputTranscription) {
                        currentInputTranscriptionRef.current += msg.serverContent.inputTranscription.text;
                        onInterimTranscript(currentInputTranscriptionRef.current);
                    }
                    if (msg.serverContent?.outputTranscription) {
                        currentOutputTranscriptionRef.current += msg.serverContent.outputTranscription.text;
                    }
                    if (msg.serverContent?.turnComplete) {
                        onTurnComplete(currentInputTranscriptionRef.current, currentOutputTranscriptionRef.current);
                        currentInputTranscriptionRef.current = '';
                        currentOutputTranscriptionRef.current = '';
                        onInterimTranscript('');
                    }
                    
                    const audioData = msg.serverContent?.modelTurn?.parts[0]?.inlineData.data;
                    if (audioData && audioContextRefs.current.output) {
                        if (audioSourcesRef.current.size === 0) onAiSpeakingStatusChange(true);
                        const ctx = audioContextRefs.current.output;
                        const start = Math.max(nextStartTimeRef.current, ctx.currentTime);
                        const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
                        const source = ctx.createBufferSource();
                        source.buffer = buffer;
                        source.connect(ctx.destination);
                        source.onended = () => {
                            audioSourcesRef.current.delete(source);
                            if (audioSourcesRef.current.size === 0) onAiSpeakingStatusChange(false);
                        };
                        source.start(start);
                        nextStartTimeRef.current = start + buffer.duration;
                        audioSourcesRef.current.add(source);
                    }

                    if (msg.toolCall) {
                        for (const fc of msg.toolCall.functionCalls) {
                            await onFunctionCall(fc.name, fc.args);
                            sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } } }));
                        }
                    }
                },
                onclose: () => stopSession(),
                onerror: () => stopSession(),
            }
        });
        sessionPromiseRef.current = sessionPromise;
    } catch (e) {
        console.error(e);
        setError("Connection failed");
        stopSession();
    }
  }, [isLive, onFunctionCall, stopSession, onTurnComplete, onInterimTranscript, onAiSpeakingStatusChange]);

  useEffect(() => { return () => { stopSession(); } }, [stopSession]);

  return { isLive, error, startSession, stopSession };
};