/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ChatMessage {
  id: string;
  roomId: string;
  sender: string;
  text: string;
  type: 'text' | 'voice' | 'file' | 'folder';
  timestamp: number;
  payload?: string; // Contains Base64 data if voice, file, or folder. Or folder metadata.
  fileName?: string; // Optional metadata
  fileSize?: number; // Optional metadata
  filePath?: string; // Optional path for files upload inside a folder (e.g. folder/sub/file.txt)
}

export interface ChatRoom {
  id: string;
  name: string;
  created: number;
  active: boolean;
}

export interface TypingIndicator {
  username: string;
  isTyping: boolean;
}

export interface ActiveUser {
  socketId: string;
  username: string;
  roomId: string;
  isTyping: boolean;
}
