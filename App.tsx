import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { MediaVersion, Session } from './types';
import { editImage } from './services/geminiService';
import { SparklesIcon, DownloadIcon, MicIcon, PlusIcon, ZoomInIcon, ZoomOutIcon, EyeIcon, RefreshCcwIcon, FrogIcon } from './components/icons';
import { useGeminiLive } from './hooks/useGeminiLive';

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (error) => reject(error);
    });
};

// --- Sound Effects Utility ---
const playSound = (type: 'start' | 'scribble' | 'success' | 'error') => {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === 'start') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
    } else if (type === 'scribble') {
        const bufferSize = ctx.sampleRate * 0.2; // Longer scribble
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
        
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.05, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        noise.connect(noiseGain);
        noiseGain.connect(ctx.destination);
        noise.start(now);
    } else if (type === 'success') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.2); // G5
        osc.frequency.setValueAtTime(1046.50, now + 0.3); // C6
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
    } else if (type === 'error') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(110, now);
        osc.frequency.linearRampToValueAtTime(55, now + 0.3);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
    }
};


// --- Components ---

const Header = ({ sessions, activeId, onSelect, onNew }: { sessions: Session[], activeId: string | null, onSelect: (id: string) => void, onNew: () => void }) => (
    <header className="h-14 md:h-16 border-b border-white/10 bg-[#050505] flex items-center justify-between px-4 md:px-6 z-30 shrink-0">
        <div className="flex items-center gap-3 md:gap-4">
             <div className="w-8 h-8 md:w-10 md:h-10 bg-white/10 rounded-full flex items-center justify-center border border-white/20">
                <FrogIcon className="w-5 h-5 md:w-6 md:h-6 text-white" />
             </div>
            <span className="font-mono font-black tracking-tighter text-white text-lg md:text-2xl truncate">FORGY AI EDITOR</span>
        </div>
        <div className="hidden md:flex items-center gap-3">
            {sessions.map((s, i) => (
                <button 
                    key={s.id}
                    onClick={() => onSelect(s.id)}
                    className={`px-4 py-1.5 rounded-full text-xs font-mono transition-all duration-300 ${activeId === s.id ? 'bg-white text-black font-bold' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
                >
                    SESSION_{i+1}
                </button>
            ))}
            <button onClick={onNew} className="w-8 h-8 flex items-center justify-center bg-white/10 rounded-full hover:bg-white text-white hover:text-black transition-colors">
                <PlusIcon className="w-4 h-4" />
            </button>
        </div>
    </header>
);

type MascotMode = 'idle' | 'listening' | 'speaking' | 'drawing' | 'success';

const Mascot = React.memo(({ mode }: { mode: MascotMode }) => {
    const [blink, setBlink] = useState(false);
    const [pupilPos, setPupilPos] = useState({ x: 0, y: 0 });

    // Blinking Logic
    useEffect(() => {
        const interval = setInterval(() => {
            setBlink(true);
            setTimeout(() => setBlink(false), 150);
        }, 4000);
        return () => clearInterval(interval);
    }, []);

    // Mouse Tracking Logic
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (mode !== 'idle' && mode !== 'listening') return;
            const x = Math.max(-4, Math.min(4, (e.clientX / window.innerWidth) * 8 - 4));
            const y = Math.max(-4, Math.min(4, (e.clientY / window.innerHeight) * 8 - 4));
            setPupilPos({ x, y });
        };
        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, [mode]);

    const isDrawing = mode === 'drawing';
    
    const containerClass = isDrawing 
        ? "absolute bottom-[20px] right-[10px] w-[220px] h-[220px] md:w-[300px] md:h-[300px] z-40 pointer-events-none transition-all duration-500 ease-in-out" 
        : "absolute top-4 right-4 md:top-6 md:right-6 w-24 h-24 md:w-32 md:h-32 z-30 pointer-events-none transition-all duration-500 ease-in-out";

    return (
        <div className={containerClass}>
             {/* Status Badge - Neon Style */}
             {isDrawing && (
                <div className="absolute -top-8 right-0 bg-black border border-green-500 text-green-400 px-3 py-1 font-mono text-xs tracking-widest flex items-center gap-2 shadow-[0_0_10px_rgba(0,255,0,0.2)]">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"/>
                    SKETCHING...
                </div>
             )}

            <svg viewBox="0 0 200 200" className="w-full h-full overflow-visible">
                {/* Styles for the Sketch Look */}
                <defs>
                    <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#00ff99" floodOpacity="0.5"/>
                    </filter>
                </defs>

                <g transform="translate(0, 10)" filter="url(#neonGlow)">
                    {/* Body Outline - Sketchy */}
                    <path 
                        d="M40,140 C30,100 40,80 50,70 C60,40 140,40 150,70 C160,80 170,100 160,140 C170,160 30,160 40,140 Z" 
                        fill="#050505" 
                        stroke="#e0e0e0" 
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={mode === 'idle' ? 'animate-breathe' : ''}
                    />

                    {/* Eyes Container */}
                    <g transform="translate(0, -5)">
                        {/* Left Eye */}
                        <g transform={`translate(${mode === 'idle' ? pupilPos.x : 0}, ${mode === 'idle' ? pupilPos.y : 0})`}>
                             <circle cx="60" cy="50" r="18" fill="#000" stroke="#e0e0e0" strokeWidth="3" />
                             {blink && mode !== 'success' ? (
                                 <line x1="45" y1="50" x2="75" y2="50" stroke="#e0e0e0" strokeWidth="3"/>
                             ) : (
                                 <circle cx="60" cy="50" r="6" fill="#00ff99" className={mode === 'listening' ? 'animate-pulse' : ''} />
                             )}
                        </g>
                        {/* Right Eye */}
                         <g transform={`translate(${mode === 'idle' ? pupilPos.x : 0}, ${mode === 'idle' ? pupilPos.y : 0})`}>
                            <circle cx="140" cy="50" r="18" fill="#000" stroke="#e0e0e0" strokeWidth="3" />
                            {blink && mode !== 'success' ? (
                                <line x1="125" y1="50" x2="155" y2="50" stroke="#e0e0e0" strokeWidth="3"/>
                            ) : (
                                 <circle cx="140" cy="50" r="6" fill="#00ff99" className={mode === 'listening' ? 'animate-pulse' : ''} />
                            )}
                        </g>
                    </g>

                    {/* Mouth */}
                    <g transform="translate(100, 95)">
                         {mode === 'speaking' ? (
                             <path d="M-15,0 Q0,15 15,0" fill="none" stroke="#e0e0e0" strokeWidth="3" strokeLinecap="round">
                                 <animate attributeName="d" values="M-15,0 Q0,15 15,0; M-15,5 Q0,-5 15,5; M-15,0 Q0,15 15,0" dur="0.3s" repeatCount="indefinite" />
                             </path>
                         ) : mode === 'success' ? (
                             <path d="M-20,-5 Q0,15 20,-5" fill="none" stroke="#00ff99" strokeWidth="3" strokeLinecap="round" />
                         ) : (
                             <path d="M-10,0 Q0,5 10,0" fill="none" stroke="#e0e0e0" strokeWidth="3" strokeLinecap="round" />
                         )}
                    </g>

                    {/* Arms & Action */}
                    {isDrawing ? (
                        <g className="animate-scribble-fast origin-[130px_110px]">
                             {/* Right Arm Holding Pencil */}
                             <path d="M140,100 Q160,80 130,130" fill="none" stroke="#e0e0e0" strokeWidth="4" strokeLinecap="round" />
                             {/* The Pencil */}
                             <line x1="130" y1="130" x2="120" y2="150" stroke="#fff" strokeWidth="3" />
                             {/* Scribble Effect on Canvas */}
                             <path 
                                d="M100,150 L110,140 L120,160 L130,140 L140,150" 
                                fill="none" 
                                stroke="#00ff99" 
                                strokeWidth="2" 
                                opacity="0.8"
                                className="animate-scribble"
                             />
                        </g>
                    ) : (
                        <>
                           <path d="M45,110 Q30,130 60,140" fill="none" stroke="#e0e0e0" strokeWidth="4" strokeLinecap="round" />
                           <path d="M155,110 Q170,130 140,140" fill="none" stroke="#e0e0e0" strokeWidth="4" strokeLinecap="round" />
                        </>
                    )}
                </g>
            </svg>
        </div>
    );
});

const MediaViewer = ({ currentVersion, originalVersion }: { currentVersion: MediaVersion, originalVersion: MediaVersion }) => {
    const [scale, setScale] = useState(1);
    const [showOriginal, setShowOriginal] = useState(false);
    
    const activeVersion = showOriginal ? originalVersion : currentVersion;

    return (
        <div className="relative w-full h-full flex items-center justify-center bg-[#080808] overflow-hidden group shadow-inner z-10">
             {/* Grid Background */}
             <div className="absolute inset-0 opacity-15 pointer-events-none" 
                  style={{ backgroundImage: 'radial-gradient(#444 1px, transparent 1px)', backgroundSize: '32px 32px' }}>
             </div>

            <div 
                className="w-full h-full flex items-center justify-center transition-transform duration-200 ease-out p-4 md:p-16"
                style={{ transform: `scale(${scale})` }}
            >
                <img src={activeVersion.src} alt="Content" className="max-w-full max-h-full object-contain shadow-2xl ring-1 ring-white/10 rounded-sm" />
            </div>

            {/* Controls */}
            <div className="absolute bottom-4 md:bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 md:gap-4 p-2 md:p-3 bg-[#1a1a1a]/90 border border-white/10 rounded-full shadow-2xl z-50 backdrop-blur-md">
                <button onClick={() => setScale(s => Math.max(1, s - 0.5))} className="p-1.5 md:p-2 hover:bg-white/10 rounded-full text-white transition-colors"><ZoomOutIcon className="w-4 h-4 md:w-5 md:h-5" /></button>
                <button onClick={() => setScale(s => Math.min(3, s + 0.5))} className="p-1.5 md:p-2 hover:bg-white/10 rounded-full text-white transition-colors"><ZoomInIcon className="w-4 h-4 md:w-5 md:h-5" /></button>
                <button onClick={() => setScale(1)} className="p-1.5 md:p-2 hover:bg-white/10 rounded-full text-white transition-colors"><RefreshCcwIcon className="w-4 h-4 md:w-5 md:h-5" /></button>
                <div className="w-px h-5 md:h-6 bg-white/20 mx-0.5"></div>
                <button 
                    onMouseDown={() => setShowOriginal(true)}
                    onMouseUp={() => setShowOriginal(false)}
                    onMouseLeave={() => setShowOriginal(false)}
                    onTouchStart={() => setShowOriginal(true)}
                    onTouchEnd={() => setShowOriginal(false)}
                    className={`px-3 py-1 md:px-4 md:py-1.5 rounded-full text-xs md:text-sm font-medium transition-all ${showOriginal ? 'bg-white text-black shadow-lg scale-105' : 'hover:bg-white/20 text-white'}`}
                >
                    COMPARE
                </button>
            </div>
        </div>
    );
};

const VisionBoard = ({ transcript, interimTranscript }: { transcript: string[], interimTranscript: string }) => {
    const bottomRef = useRef<HTMLDivElement>(null);
    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [transcript, interimTranscript]);

    return (
        <div className="flex flex-col h-full bg-[#0A0A0A]">
            <div className="p-3 md:p-4 border-b border-white/10 flex items-center justify-between bg-[#050505] shrink-0">
                <h3 className="text-[10px] md:text-xs font-mono uppercase tracking-widest text-gray-400 font-semibold">Live Transcript</h3>
                <div className="flex items-center gap-2">
                    <span className="text-[9px] md:text-[10px] text-gray-600 font-mono">REC</span>
                    <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-green-500 rounded-full animate-pulse"></div>
                </div>
            </div>
            
            <div className="flex-grow overflow-y-auto custom-scrollbar p-4 space-y-4 md:space-y-6 bg-[#0A0A0A]">
                {transcript.length === 0 && !interimTranscript && (
                    <div className="h-full flex flex-col items-center justify-center text-gray-800 space-y-3 opacity-40">
                        <MicIcon className="w-8 h-8 md:w-10 md:h-10" />
                        <p className="text-xs md:text-sm font-mono">Waiting for voice...</p>
                    </div>
                )}
                {transcript.map((line, i) => {
                    const isUser = line.startsWith('**You:**');
                    const text = line.replace(/\*\*(You:|AI:)\*\*\s?/, '');
                    return (
                        <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[90%] md:max-w-[85%] p-2.5 md:p-3.5 rounded-xl text-xs md:text-sm leading-relaxed shadow-sm ${isUser ? 'bg-[#222] text-gray-100 border border-white/5 rounded-tr-none' : 'text-gray-300 bg-[#0f0f0f] border border-white/5 rounded-tl-none'}`}>
                                {!isUser && <span className="text-[9px] md:text-[10px] font-bold text-green-500 block mb-1 uppercase tracking-wider">FORGY AI</span>}
                                <p dangerouslySetInnerHTML={{ __html: text }} />
                            </div>
                        </div>
                    );
                })}
                {interimTranscript && (
                    <div className="flex justify-end">
                         <div className="max-w-[85%] p-2.5 md:p-3 bg-[#111] text-gray-400 border border-dashed border-white/10 rounded-xl text-xs md:text-sm italic animate-pulse">
                            {interimTranscript}...
                        </div>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>
        </div>
    );
};

export default function App() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccessAnim, setIsSuccessAnim] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isAiSpeaking, setIsAiSpeaking] = useState(false);
    const [interimTranscript, setInterimTranscript] = useState('');
    const [isKeyReady, setIsKeyReady] = useState(false);

    const sessionsRef = useRef(sessions);
    const activeSessionIdRef = useRef(activeSessionId);
    useEffect(() => {
        sessionsRef.current = sessions;
        activeSessionIdRef.current = activeSessionId;
    }, [sessions, activeSessionId]);

    useEffect(() => {
        const checkKey = async () => {
            const aistudio = (window as any).aistudio;
            if (aistudio && await aistudio.hasSelectedApiKey()) setIsKeyReady(true);
        };
        checkKey();
    }, []);

    const handleSelectKey = async () => {
        const aistudio = (window as any).aistudio;
        if (aistudio) {
            await aistudio.openSelectKey();
            setIsKeyReady(true);
        }
    };

    const updateSession = (updater: (s: Session) => Session) => {
        const id = activeSessionIdRef.current;
        if (id) setSessions(prev => prev.map(s => s.id === id ? updater(s) : s));
    };

    const handleTurnComplete = useCallback((user: string, ai: string) => {
        const id = activeSessionIdRef.current;
        if (!id) return;
        setSessions(prev => prev.map(s => s.id === id ? {
            ...s, transcript: [...s.transcript, ...(user ? [`**You:** ${user}`] : []), ...(ai ? [`**AI:** ${ai}`] : [])]
        } : s));
    }, []);

    const handleGenerate = useCallback(async (type: 'edit', prompt: string) => {
        const session = sessionsRef.current.find(s => s.id === activeSessionIdRef.current);
        if (!session) return { error: "No session" };

        setIsLoading(true);
        playSound('start');
        playSound('scribble'); 
        
        const scribbleInterval = setInterval(() => {
             if (Math.random() > 0.5) playSound('scribble');
        }, 2000);

        try {
            const sourceImage = session.versions[session.versions.length - 1].src;
            const resultUrl = await editImage(sourceImage, prompt);
            
            updateSession(s => ({
                ...s,
                versions: [...s.versions, { src: resultUrl, prompt, type: 'image' }],
                currentIndex: s.versions.length
            }));
            
            setIsSuccessAnim(true);
            playSound('success');
            setTimeout(() => setIsSuccessAnim(false), 4000);
            return { success: true };
        } catch (e) {
            console.error(e);
            playSound('error');
            setError("Generation failed. Please try again.");
            setTimeout(() => setError(null), 3000);
            return { error: "Failed" };
        } finally {
            clearInterval(scribbleInterval);
            setIsLoading(false);
        }
    }, []);

    const handleFunctionCall = useCallback(async (name: string, args: any) => {
        if (name === 'editImage') return handleGenerate('edit', args.prompt);
        return { error: "Unknown" };
    }, [handleGenerate]);

    const { isLive, startSession, stopSession } = useGeminiLive({
        onFunctionCall: handleFunctionCall,
        onTurnComplete: handleTurnComplete,
        onInterimTranscript: setInterimTranscript,
        onAiSpeakingStatusChange: setIsAiSpeaking
    });

    const handleStartLiveSession = () => {
        const session = sessions.find(s => s.id === activeSessionId);
        // Pass the current image to the live session for context
        const currentImage = session?.versions[session.currentIndex]?.src;
        startSession(currentImage);
    };

    const handleImageUpload = useCallback(async (file: File) => {
        setIsLoading(true);
        try {
            const base64 = await fileToBase64(file);
            const newSession: Session = {
                id: Date.now().toString(),
                versions: [{ src: base64, prompt: 'Original', type: 'image' }],
                transcript: [],
                currentIndex: 0
            };
            setSessions(prev => [...prev, newSession]);
            setActiveSessionId(newSession.id);
            // Delay slightly to let state settle, then start session with the new image
            setTimeout(() => {
                // Since we are inside a callback, we should grab the 'newSession' data directly
                // But startSession is from the hook.
                // We can manually trigger it.
                // Note: We can't easily access startSession immediately here without closure issues if we used the prop directly,
                // but since useGeminiLive is stable...
                // Actually, best to let the user click "Start" or trigger it via an effect, but
                // previous requirement was "auto start".
                // We will trigger the click handler logic manually.
                // However, startSession is defined in the component scope.
                // We need to pass the base64 directly.
                // We can't call startSession here because it might be stale if not careful, 
                // but since it's a ref-based hook it should be fine.
                // BUT, `handleStartLiveSession` wrapper uses `sessions` state which might be stale inside this async function.
                // So we call startSession(base64) directly.
            }, 500);
        } catch (e) { console.error(e); }
        finally { setIsLoading(false); }
    }, []);
    
    // Auto-start session when a new session is created (if desired, or just rely on user interaction). 
    // Previous request said "fast image add then voice mode auto turn on".
    // We'll use an effect to trigger it when activeSessionId changes if it's a new one?
    // Simplest is to trigger it in the upload flow above, but let's ensure we pass the image.
    useEffect(() => {
        if (activeSessionId && sessions.length > 0 && !isLive) {
             const session = sessions.find(s => s.id === activeSessionId);
             if (session && session.versions.length === 1 && session.transcript.length === 0) {
                 // It's a brand new session
                 startSession(session.versions[0].src);
             }
        }
    }, [activeSessionId, sessions.length]); // Dependency on length to detect new adds


    const activeSession = sessions.find(s => s.id === activeSessionId);
    
    let mascotMode: MascotMode = 'idle';
    if (isSuccessAnim) mascotMode = 'success';
    else if (isLoading) mascotMode = 'drawing';
    else if (isAiSpeaking) mascotMode = 'speaking';
    else if (isLive) mascotMode = 'listening';

    if (!isKeyReady) {
        return (
            <div className="w-screen h-screen flex flex-col items-center justify-center bg-black text-white overflow-hidden relative px-4">
                 {/* Background decoration */}
                 <div className="absolute inset-0 opacity-20 pointer-events-none" 
                      style={{ backgroundImage: 'radial-gradient(#333 1px, transparent 1px)', backgroundSize: '40px 40px' }}>
                 </div>
                
                <div className="relative z-10 flex flex-col items-center text-center">
                     <div className="w-24 h-24 md:w-32 md:h-32 bg-white/10 rounded-full flex items-center justify-center border border-white/20 mb-6 md:mb-8 animate-float">
                        <FrogIcon className="w-16 h-16 md:w-20 md:h-20 text-white" />
                    </div>
                    <h1 className="text-4xl md:text-8xl font-black mb-4 md:mb-6 font-mono tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-500">FORGY.AI</h1>
                    <p className="text-gray-400 mb-8 md:mb-12 font-mono tracking-wide text-sm md:text-base">The Creative Companion</p>
                    <button onClick={handleSelectKey} className="px-8 py-3 md:px-10 md:py-4 bg-white text-black font-black font-mono hover:scale-105 transition-all rounded-full text-sm md:text-lg shadow-xl hover:shadow-white/20">
                        LAUNCH EDITOR
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen bg-[#000] text-white overflow-hidden font-sans selection:bg-white selection:text-black">
            <Header sessions={sessions} activeId={activeSessionId} onSelect={setActiveSessionId} onNew={() => setActiveSessionId(null)} />
            
            {error && (
                <div className="fixed top-24 left-1/2 -translate-x-1/2 bg-red-900/80 backdrop-blur text-white px-6 py-2 md:px-8 md:py-3 rounded-full font-mono text-xs md:text-sm z-[100] shadow-2xl border border-red-500/50 flex items-center gap-3">
                    <span className="text-lg md:text-xl">⚠️</span> {error}
                </div>
            )}

            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
                {!activeSession ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-4 text-center relative">
                        <Mascot mode="idle" />
                        <div className="z-10 flex flex-col items-center animate-[float_6s_ease-in-out_infinite]">
                             <div 
                                className="w-32 h-32 md:w-40 md:h-40 border-2 border-dashed border-white/20 rounded-full flex items-center justify-center hover:border-white hover:bg-white/5 transition-all cursor-pointer mb-6 md:mb-8 group shadow-[0_0_30px_rgba(0,0,0,0.5)]"
                                onClick={() => document.getElementById('upload-input')?.click()}
                            >
                                <PlusIcon className="w-10 h-10 md:w-12 md:h-12 text-gray-600 group-hover:text-white transition-colors" />
                            </div>
                            <h2 className="text-3xl md:text-6xl font-black tracking-tighter uppercase text-white/90 mb-4">Studio Empty</h2>
                            <p className="text-gray-500 font-mono text-sm md:text-base">Upload an image to wake Forgy</p>
                            <input id="upload-input" type="file" className="hidden" onChange={e => e.target.files?.[0] && handleImageUpload(e.target.files[0])} accept="image/*" />
                        </div>
                    </div>
                ) : (
                    <>
                        {/* LEFT SIDEBAR: TIMELINE (Desktop) */}
                        <aside className="hidden lg:flex w-72 bg-[#0A0A0A] flex-col z-20 border-r border-white/10 shadow-xl">
                            <div className="p-4 bg-[#050505] border-b border-white/10 flex items-center justify-between">
                                <span className="text-xs font-mono uppercase tracking-widest text-gray-400 font-bold">Timeline</span>
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
                                {activeSession.versions.map((v, i) => (
                                    <button 
                                        key={i} 
                                        onClick={() => updateSession(s => ({...s, currentIndex: i}))} 
                                        className={`w-full group flex items-start gap-4 p-3 rounded-xl transition-all duration-300 border ${activeSession.currentIndex === i ? 'bg-[#1A1A1A] border-white/40 shadow-md scale-[1.02]' : 'border-transparent hover:bg-[#111] hover:border-white/10'}`}
                                    >
                                        <div className="w-16 h-16 bg-black rounded-lg border border-white/10 overflow-hidden shrink-0 relative shadow-inner">
                                            <img src={v.src} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                        <div className="flex-1 text-left">
                                            <div className="flex items-center justify-between mb-1">
                                                <p className="text-[10px] text-gray-500 font-mono font-bold">VERSION {i+1}</p>
                                                {activeSession.currentIndex === i && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                                            </div>
                                            <p className="text-xs text-gray-300 line-clamp-2 leading-relaxed font-medium">{v.prompt}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </aside>

                        {/* MAIN CANVAS AREA (Center) */}
                        <main className="flex-1 flex flex-col relative bg-[#050505] order-1 lg:order-2 overflow-hidden min-h-0">
                             {/* Mascot Overlay */}
                            <Mascot mode={mascotMode} />
                            <MediaViewer 
                                currentVersion={activeSession.versions[activeSession.currentIndex]}
                                originalVersion={activeSession.versions[0]}
                            />
                        </main>

                        {/* RIGHT SIDEBAR / MOBILE BOTTOM: TRANSCRIPT & CONTROLS */}
                        <aside className="w-full lg:w-96 bg-[#0A0A0A] flex flex-col z-20 shadow-2xl border-t lg:border-t-0 lg:border-l border-white/10 h-[35vh] lg:h-auto order-3 shrink-0">
                            
                            {/* Mobile Timeline Strip (Only Visible on Mobile) */}
                            <div className="lg:hidden flex overflow-x-auto custom-scrollbar p-2 md:p-3 border-b border-white/10 gap-3 shrink-0 bg-[#080808]">
                                 {activeSession.versions.map((v, i) => (
                                    <button 
                                        key={i}
                                        onClick={() => updateSession(s => ({...s, currentIndex: i}))}
                                        className={`w-12 h-12 md:w-14 md:h-14 rounded-lg border shrink-0 overflow-hidden relative transition-all ${activeSession.currentIndex === i ? 'border-white ring-2 ring-white/20' : 'border-white/10 opacity-50'}`}
                                    >
                                        <img src={v.src} className="w-full h-full object-cover" />
                                    </button>
                                 ))}
                            </div>

                            {/* Transcript Area */}
                            <div className="flex-1 flex flex-col min-h-0">
                                <VisionBoard transcript={activeSession.transcript} interimTranscript={interimTranscript} />
                            </div>
                            
                            {/* Controls */}
                            <div className="p-4 md:p-6 bg-[#080808] border-t border-white/10 shrink-0">
                                <button 
                                    onClick={isLive ? stopSession : handleStartLiveSession} 
                                    disabled={isLoading}
                                    className={`
                                        w-full py-3 md:py-4 rounded-full flex items-center justify-center gap-3 font-mono text-xs md:text-sm font-bold tracking-widest transition-all duration-300 shadow-lg
                                        ${isLive ? 'bg-red-950/30 border border-red-500 text-red-400 hover:bg-red-900/50' : 'bg-white text-black border border-white hover:bg-gray-200 transform hover:-translate-y-1 hover:shadow-white/20'}
                                        ${isLoading ? 'opacity-50 cursor-not-allowed transform-none' : ''}
                                    `}
                                >
                                    {isLive ? (
                                        <>
                                            <span className="relative flex h-2.5 w-2.5 md:h-3 md:w-3">
                                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 md:h-3 md:w-3 bg-red-500"></span>
                                            </span>
                                            STOP LISTENING
                                        </>
                                    ) : (
                                        <>
                                            <MicIcon className="w-4 h-4 md:w-5 md:h-5" />
                                            ASK FORGY
                                        </>
                                    )}
                                </button>
                            </div>
                        </aside>
                    </>
                )}
            </div>
        </div>
    );
}