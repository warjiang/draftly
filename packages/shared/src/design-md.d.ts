export type DesignMeta = {
  name?: string;
  colors?: Record<string, string>;
  typography?: {
    fontFamily?: string;
    scale?: Record<string, string>;
  };
  spacing?: {
    unit?: string;
    scale?: string[];
  };
  radius?: Record<string, string>;
  shadows?: Record<string, string>;
  antiPatterns?: string[];
  [key: string]: unknown;
};

export function parseDesignMd(content: string): { meta: DesignMeta; body: string };
export function serializeDesignMd(meta: DesignMeta, body: string): string;
export function defaultDesignMd(overrides?: Partial<DesignMeta>): string;
export function validateDesignMd(content: string): string[];
