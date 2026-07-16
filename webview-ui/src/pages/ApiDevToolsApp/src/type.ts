export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type RequestTab = 'params' | 'body' | 'headers' | 'cookies' | 'auth' | 'pre' | 'post';
export type ResponseTab = 'body' | 'headers' | 'raw';
export type BodyType = 'none' | 'json' | 'raw' | 'form-urlencoded';
export type AuthType = 'none' | 'bearer' | 'basic';

export interface KeyValueItem {
  id: string;
  enabled: boolean;
  key: string;
  value: string;
  description?: string;
}

export type GlobalVariable = KeyValueItem;

export interface AuthConfig {
  type: AuthType;
  token: string;
  username: string;
  password: string;
}

export interface ApiRequestConfig {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValueItem[];
  headers: KeyValueItem[];
  cookies: KeyValueItem[];
  bodyType: BodyType;
  bodyRaw: string;
  bodyForm: KeyValueItem[];
  auth: AuthConfig;
  preScript: string;
  postScript: string;
  timeout: number;
}

export interface ApiInterfaceItem {
  id: string;
  name: string;
  description: string;
  method: HttpMethod;
  url: string;
  request: ApiRequestConfig;
  createdAt: number;
  updatedAt: number;
}

export interface ApiProject {
  id: string;
  name: string;
  description: string;
  interfaces: ApiInterfaceItem[];
  createdAt: number;
  updatedAt: number;
}

export interface HistoryItem {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  status: number;
  duration: number;
  timestamp: number;
  request: ApiRequestConfig;
}

export interface ApiResponsePayload {
  requestId: string;
  ok: boolean;
  url: string;
  status: number;
  statusText: string;
  duration: number;
  size: number;
  headers: Record<string, string>;
  body: string;
  error?: string;
}

export interface PersistedState {
  globals: GlobalVariable[];
  request: ApiRequestConfig;
  history: HistoryItem[];
  projects: ApiProject[];
  activeProjectId: string;
  activeInterfaceId: string;
}

export type ManageDialog =
  | { kind: 'project-create'; title: string; label: string; value: string }
  | { kind: 'project-rename'; title: string; label: string; value: string; projectId: string }
  | { kind: 'interface-create'; title: string; label: string; value: string }
  | { kind: 'project-delete'; title: string; message: string; projectId: string; projectName: string }
  | { kind: 'interface-delete'; title: string; message: string; projectId: string; interfaceId: string; interfaceName: string }
  | { kind: 'clear-all'; title: string; message: string }
  | null;

export type LeaveConfirmAction = 'save' | 'discard' | 'cancel';

export type LeaveConfirmDialog = {
  title: string;
  message: string;
} | null;