export interface MapAssetReader {
  signal?: AbortSignal;
  has(name: string): boolean;
  size(name: string): number;
  bytes(name: string, onBytes?: (bytes: number) => void): Promise<Uint8Array | null>;
  json(name: string): Promise<any>;
}