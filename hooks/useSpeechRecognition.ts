// FIX: Import the default React object to use React types like React.Dispatch.
import React, { useState, useEffect, useRef } from 'react';

// Type definitions for the Web Speech API
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

declare global {
    interface Window {
        SpeechRecognition: {
            new(): SpeechRecognition;
        };
        webkitSpeechRecognition: {
            new(): SpeechRecognition;
        };
    }
}


interface SpeechRecognitionHook {
  isListening: boolean;
  transcript: string;
  setTranscript: React.Dispatch<React.SetStateAction<string>>;
  startListening: () => void;
  stopListening: () => void;
  hasRecognitionSupport: boolean;
}

const useSpeechRecognition = (): SpeechRecognitionHook => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  
  const isListeningRef = useRef(false);
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  // Ref to store the finalized part of the transcript, so interim results don't override it.
  const finalTranscriptRef = useRef('');

  useEffect(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      console.warn("Speech recognition not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognitionRef.current = recognition;
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcriptPart = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          // Append the finalized transcript part to our ref
          finalTranscriptRef.current += transcriptPart + ' ';
        } else {
          interimTranscript += transcriptPart;
        }
      }
      // Update the state with the full transcript (final + interim) for immediate feedback
      setTranscript(finalTranscriptRef.current + interimTranscript);
    };

    recognition.onend = () => {
      if (isListeningRef.current) {
        console.log("Speech recognition ended unexpectedly. Attempting to restart...");
        try {
          setTimeout(() => {
            if (isListeningRef.current && recognitionRef.current) {
              recognitionRef.current.start();
            }
          }, 250);
        } catch (e) {
          console.error("Failed to restart speech recognition:", e);
          setIsListening(false);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error(`Speech recognition error: ${event.error}. Message: ${event.message}`);
      
      const isFatalError = event.error === 'not-allowed' || event.error === 'service-not-allowed';

      if (isFatalError) {
        setIsListening(false);
      }
    };

    return () => {
      isListeningRef.current = false;
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.stop();
      }
    };
  }, []);

  const startListening = () => {
    if (recognitionRef.current && !isListening) {
      setTranscript('');
      finalTranscriptRef.current = ''; // Reset the final transcript
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current && isListening) {
      isListeningRef.current = false;
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };
  
  const hasRecognitionSupport = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  return {
    isListening,
    transcript,
    setTranscript,
    startListening,
    stopListening,
    hasRecognitionSupport,
  };
};

export default useSpeechRecognition;