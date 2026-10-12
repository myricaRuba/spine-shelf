export const CATEGORY_LABELS = {
  character: "人物",
  scene: "场景",
  material: "普通素材",
  unclassified: "待分类",
} as const;
export type Category = keyof typeof CATEGORY_LABELS;
export interface ContentFeatures {
  boneNames: string[];
  slotNames: string[];
  attachmentNames: string[];
  animationNames: string[];
}
export interface Asset {
  id: string;
  name: string;
  version: string;
  runtime: string;
  format: "json" | "skel";
  source: string;
  importedAt: string;
  favorite: boolean;
  collectionId: string | null;
  tags: string[];
  note: string;
  demo: boolean;
  size: number;
  animations: string[];
  skins: string[];
  bones: number;
  slots: number;
  pages: number;
  pma: boolean;
  thumbnail: boolean;
  category: Category;
  categorySource: "auto" | "manual";
  categoryConfidence: "high" | "medium" | "low" | "manual";
  categoryReasons: string[];
  classificationVersion: number;
  contentFeatures: ContentFeatures;
  contentRevision?: number;
  reskins?: { name: string; baseSkin: string; atlas: string; taskId: string }[];
}
export interface ReskinJob {
  animationRequirements?: {name:string;description:string}[];
  kind?: 'generation';
  animations?: string[];
  id: string;
  assetId: string;
  assetName: string;
  name: string;
  prompt: string;
  baseSkin: string;
  replaceSkin?: string;
  status: "queued" | "processing" | "applying" | "completed" | "failed" | "cancelled";
  message: string;
  createdAt: string;
  updatedAt: string;
  execution?: {runId:string;state:"running"|"completed"|"failed"|"cancelled"|"interrupted";startedAt:string;endedAt?:string;threadId?:string};
}
export interface Library {
  version: number;
  assets: Asset[];
  collections: { id: string; name: string }[];
  projects: GameProject[];
  root: string;
}
export interface ProjectMember {assetId:string;categoryId:string;skin:string;label:string;note:string;addedAt:string;}
export interface GameProject {
  id:string;name:string;note:string;createdAt:string;updatedAt:string;
  categories:{id:string;name:string}[];members:ProjectMember[];
}
export type ProjectAction = "create"|"rename"|"remove"|"category"|"removeCategory"|"add"|"member"|"removeMembers";
export interface ProjectInput {projectId?:string;name?:string;note?:string;categoryId?:string;assetId?:string;assetIds?:string[];skin?:string;label?:string;}
export type SpineExportTarget = 'original'|'3.6'|'3.8'|'4.0'|'4.1'|'4.2'|'4.3';
export interface ProjectExportOptions {targetVersion:SpineExportTarget;assetIds?:string[];skinMode?:'switchable'|'current';}
export interface SpineConverterStatus {available:boolean;path:string;message:string;}
export interface ProjectExportPlan {
  targetVersion:SpineExportTarget;
  skinMode:'switchable'|'current';
  assets:{id:string;name:string;version:string;action:'copy'|'convert'|'blocked';message:string;skins:string[]}[];
  converter:SpineConverterStatus;canExport:boolean;
}
export interface ProjectExportProgress {projectId:string;completed:number;total:number;name:string;phase:"copying"|"packing"|"converting";}
export interface ReskinProgressEntry {
  id: string;
  at?: string;
  updatedAt?: string;
  kind: "status" | "message" | "tool" | "error";
  status: "info" | "running" | "completed" | "failed";
  text: string;
  tool?: string;
  detail?: string;
  exitCode?: number;
  legacy?: boolean;
}
export interface ReskinDetails {
  job: ReskinJob;
  entries: ReskinProgressEntry[];
  trimmed: number;
  running: boolean;
}
export interface ImportReport {
  added: string[];
  duplicates: string[];
  errors: { file: string; relativePath?: string; message: string }[];
  ignoredProjects?: string[];
  library: Library;
}
export interface ShelfAPI {
  generationCapabilities():Promise<{actionTable:boolean;rigVersion?:number}>;
  generationList():Promise<ReskinJob[]>;
  generationDetails(taskId:string):Promise<ReskinDetails>;
  generationCreate(input:{name:string;prompt:string;animationRequirements:{name:string;description:string}[]}):Promise<{job:ReskinJob;handoff:string}>;
  generationStart(taskId:string):Promise<ReskinJob>;
  generationCancel(taskId:string):Promise<ReskinJob>;
  readonly platform: string;
  getLibrary(): Promise<Library>;
  projectMutate(action:ProjectAction,input:ProjectInput):Promise<{library:Library;projectId:string}>;
  projectExport(id:string,options?:ProjectExportOptions):Promise<{path:string;assets:number;bytes:number;bakedSkins:number;converted:number}|null>;
  projectExportPlan(id:string,options:ProjectExportOptions):Promise<ProjectExportPlan>;
  projectSelectSpine():Promise<SpineConverterStatus|null>;
  onProjectExportProgress(callback:(progress:ProjectExportProgress)=>void):()=>void;
  importDialog(
    kind: "folder" | "files",
    collectionId?: string,
  ): Promise<ImportReport | null>;
  importPaths(paths: string[], collectionId?: string): Promise<ImportReport>;
  getDroppedPaths(files: File[]): string[];
  loadExamples(): Promise<ImportReport>;
  update(id: string, patch: Partial<Asset>): Promise<Library>;
  classify(
    id?: string,
  ): Promise<{
    library: Library;
    classified: number;
    unclassified: number;
    skipped: number;
    errors: { id: string; name: string; message: string }[];
  }>;
  thumbnail(id: string, data: string, revision?: number): Promise<Library>;
  onLibraryChange(callback: (library: Library) => void): () => void;
  onReskinChange(callback: () => void): () => void;
  reskinStatus(): Promise<{ available: boolean; lastConnectedAt: string | null; codex:{ready:boolean;message:string} }>;
  reskinList(assetId: string): Promise<ReskinJob[]>;
  reskinCapabilities(): Promise<{manageSkins:boolean}>;
  reskinRemove(assetId:string, name:string, expectedTaskId:string): Promise<{asset:Asset;fallbackSkin:string}>;
  reskinDetails(taskId: string): Promise<ReskinDetails>;
  reskinCreate(input: { assetId: string; name: string; prompt: string; baseSkin: string; replaceSkin?:string; expectedTaskId?:string }): Promise<{ job: ReskinJob; handoff: string }>;
  reskinStart(taskId:string):Promise<ReskinJob>;
  reskinCancel(taskId:string):Promise<ReskinJob>;
  reskinCopy(taskId: string): Promise<void>;
  reskinUpdate(taskId: string, status: "queued" | "cancelled"): Promise<ReskinJob>;
  remove(id: string): Promise<Library>;
  collection(
    action: "create" | "rename" | "remove",
    id?: string,
    name?: string,
  ): Promise<Library>;
  reveal(id?: string): Promise<void>;
  saveImage(id: string, data: string): Promise<boolean>;
}
declare global {
  interface Window {
    spine36: any;
    shelf: ShelfAPI;
    spine?: any;
  }
}
export const assetUrl = (asset: Asset, file: string) =>
  `shelf://asset/${asset.id}/${file}?v=${asset.contentRevision || 0}`;
export const formatSize = (size: number) =>
  size > 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
