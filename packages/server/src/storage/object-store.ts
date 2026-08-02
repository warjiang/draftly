export type ObjectMetadata = {
  key: string;
  etag: string | null;
  checksum: string;
  size: number;
};

export interface ObjectStore {
  assertReady(): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  put(key: string, body: Uint8Array, checksum: string): Promise<ObjectMetadata>;
  delete(key: string): Promise<void>;
  head(key: string): Promise<ObjectMetadata | null>;
}
