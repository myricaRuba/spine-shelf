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
}
export interface Library {
  version: number;
  assets: Asset[];
  collections: { id: string; name: string }[];
  root: string;
}
export interface ImportReport {
  added: string[];
  duplicates: string[];
  errors: { file: string; message: string }[];
  library: Library;
}
export interface ShelfAPI {
  readonly platform: string;
  getLibrary(): Promise<Library>;
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
  thumbnail(id: string, data: string): Promise<Library>;
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
    shelf: ShelfAPI;
    spine?: any;
  }
}
export const assetUrl = (asset: Asset, file: string) =>
  `shelf://asset/${asset.id}/${file}`;
export const formatSize = (size: number) =>
  size > 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
