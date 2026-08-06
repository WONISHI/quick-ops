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

/**
 * @description API DevTools 原生 View 标题栏操作
 */
export type ApiDevToolsViewTitleAction = 'add-project' | 'add-interface' | 'save-interface' | 'share-docs' | 'export-docs' | 'show-globals' | 'clear-all' | 'send-request' | 'stop-request';

export interface ApiInterfaceGroup {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export type GroupedApiInterfaceItem = ApiInterfaceItem & {
  groupId?: string;
};

export type GroupedApiProject = Omit<ApiProject, 'interfaces'> & {
  interfaces: GroupedApiInterfaceItem[];
  groups?: ApiInterfaceGroup[];
};

export type GroupedPersistedState = Omit<PersistedState, 'projects'> & {
  projects: GroupedApiProject[];
};

export type GroupManageDialog =
  | {
      kind: 'group-create';
      title: string;
      label: string;
      value: string;
      projectId: string;
    }
  | {
      kind: 'group-rename';
      title: string;
      label: string;
      value: string;
      projectId: string;
      groupId: string;
    }
  | {
      kind: 'group-delete';
      title: string;
      message: string;
      projectId: string;
      groupId: string;
      groupName: string;
    }
  | {
      kind: 'group-interface-create';
      title: string;
      label: string;
      value: string;
      projectId: string;
      groupId: string;
    };

export type ApiManageDialog = ManageDialog | GroupManageDialog;

export interface ApiFormDataPayloadItem {
  key: string;
  type: 'text' | 'file';
  value?: string;
  fileName?: string;
  mimeType?: string;
  fileData?: string;
}
export type DetailSource = 'response' | 'request';

export interface RequestDetailPayload {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeout: number;
}

export interface ApiResponseMessagePayload extends ApiResponsePayload {
  request?: RequestDetailPayload;
}
