import { BUFFER_HIGH, BUFFER_LOW } from "./constants";

export function trimBuffer<T>(buffer: T[]): T[] {
  if (buffer.length > BUFFER_HIGH) {
    return buffer.slice(buffer.length - BUFFER_LOW);
  }
  return buffer;
}
