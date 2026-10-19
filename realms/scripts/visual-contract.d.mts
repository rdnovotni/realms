export type VisualManifest={schemaVersion:number;sha256:string;files:number;bytes:number};
export function visualManifest(base?:URL):VisualManifest;
export function checkReports(reports:unknown,manifest:VisualManifest):void;
