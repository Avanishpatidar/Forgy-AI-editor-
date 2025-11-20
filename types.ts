
export interface MediaVersion {
  src: string;
  prompt: string;
  type: 'image' | 'video';
}

export interface Session {
  id: string;
  versions: MediaVersion[];
  transcript: string[];
  currentIndex: number;
}
