export const REPO = 'ericlitman/open-pstack';
export const HARNESSES = ['claude', 'codex'] as const;
export type Harness = typeof HARNESSES[number];
export type CredentialSources = Record<Harness, string>;
export type Phase = 'resolve' | 'classify' | 'prepare' | 'exercise' | 'publish' | 'failed' | 'head-moved';
export interface Pull {
  number: number; head: { sha: string }; base: { sha: string };
  state: string; headRepo: string;
}
export interface ChangedFile { filename: string; previous_filename?: string }
export interface Registry {
  skills: string[];
  shared: string[];
  assets: string[];
  setup: string[];
  runner: string[];
  tools: string[];
  project: string[];
  nonRuntime: string[];
}
export interface Selection { paths: string[]; skills: string[]; features: string[]; noRuntime: boolean }
export interface Observation {
  harness: Harness; feature: string; surface: string; action: string; observed: string;
  transcript: string; transcriptHash: string; reviewer: 'operator';
  artifacts: { path: string; sha256: string }[];
}
export interface Installation {
  harness: Harness; cliVersion: string; pluginVersion: string; sha: string;
  location: string; treeHash: string; home: string; credentialSource?: string; sourceHash?: string;
}
export interface Receipt {
  schema: 1; repo: string; pr: number; sha: string; base: string; phase: Phase;
  selection: Selection; installations: Installation[]; observations: Observation[];
  selfTest: boolean; artifactRoot: string; publisherRevision?: string; failure?: string;
  commentUrl?: string; status?: 'success' | 'failure'; cleanup: string; started: string;
}
export interface GitHub {
  pull(pr: number): Promise<Pull>;
  files(base: string, head: string): Promise<ChangedFile[]>;
  comment(pr: number, body: string): Promise<string>;
  status(sha: string, state: 'success' | 'failure', target: string, description: string): Promise<void>;
}
export interface Driver {
  prepare(receipt: Receipt): Promise<Installation[]>;
  exercise(receipt: Receipt): Promise<Observation[]>;
  cleanup?(receipt: Receipt): Promise<void>;
}
