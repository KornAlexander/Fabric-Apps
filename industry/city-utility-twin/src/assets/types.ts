export interface MapAssetReader {
  signal?: AbortSignal;
  has(name: string): boolean;
  size(name: string): number;
  bytes(name: string, onBytes?: (bytes: number) => void): Promise<Uint8Array | null>;
  // The callers parse each document into their own shape; `unknown` would force a cast at every
  // one of them for no safety gain, so this stays permissive on purpose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json(name: string): Promise<any>;
}