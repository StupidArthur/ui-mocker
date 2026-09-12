// 后端调用的唯一出口。组件只 import api，不直接 fetch，
// 后端接口变化时只改本文件（遵循前端架构规范）。

const BASE = import.meta.env.VITE_API_BASE ?? ''
const TOKEN_KEY = 'studio_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export type User = {
  id: string
  username: string
  role: 'user' | 'admin'
  created_at: string
}

export type ColumnMeta = { name: string; dtype: string }

export type StatSummary = {
  name: string
  count: number
  missing_rate: number
  mean: number | null
  std: number | null
  min: number | null
  max: number | null
}

export type Preview = {
  columns: ColumnMeta[]
  rows: Record<string, unknown>[]
  summary: StatSummary[]
}

export type Dataset = {
  id: string
  name: string
  filename: string
  format: string
  row_count: number
  col_count: number
  time_column: string | null
  columns: ColumnMeta[]
  size_bytes: number
  created_at: string
}

export type Project = {
  id: string
  owner_id: string
  owner_name: string
  name: string
  description: string
  dataset_id: string
  dataset_name: string | null
  is_public: boolean
  node_count: number
  created_at: string
  updated_at: string
}

export type AlgorithmParam = {
  name: string
  label: string
  type: string
  default: number
}

export type Algorithm = {
  key: string
  name: string
  category: 'statistics' | 'prediction'
  description: string
  params: AlgorithmParam[]
}

export type LineageNode = {
  id: string
  project_id: string
  parent_id: string | null
  title: string
  node_type: 'root' | 'result'
  data_path: string | null
  attributes: Record<string, any>
  source_run_id: string | null
  created_at: string
}

export type RunResult = {
  algorithm: string
  name: string
  category: string
  summary: any
  derived_columns: string[]
  derived_path: string | null
  row_count: number
  preview: Preview
}

export type AlgorithmRun = {
  id: string
  project_id: string
  input_node_id: string
  algorithm: string
  params: Record<string, any>
  status: 'pending' | 'approved' | 'rejected'
  result: RunResult
  result_node_id: string | null
  created_by: string
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) }
  if (!(init?.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const resp = await fetch(`${BASE}${path}`, { ...init, headers })
  if (!resp.ok) {
    let message = resp.statusText
    try {
      const data = await resp.json()
      message = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
    } catch {
      // 保留 statusText
    }
    if (resp.status === 401) clearToken()
    throw new Error(message)
  }
  if (resp.status === 204) return undefined as T
  return resp.json() as Promise<T>
}

export const api = {
  // 认证
  register: (username: string, password: string) =>
    request<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<User>('/api/auth/me'),
  changePassword: (old_password: string, new_password: string) =>
    request<{ success: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ old_password, new_password }),
    }),

  // 管理
  listUsers: () => request<User[]>('/api/admin/users'),
  createUser: (username: string, password: string, role: string) =>
    request<User>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username, password, role }),
    }),
  resetPassword: (userId: string, new_password: string) =>
    request<{ success: boolean }>(`/api/admin/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password }),
    }),

  // 数据集
  listDatasets: () => request<Dataset[]>('/api/datasets'),
  uploadDataset: (file: File, name: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('name', name)
    return request<Dataset>('/api/datasets', { method: 'POST', body: form })
  },
  getDataset: (id: string) => request<Dataset>(`/api/datasets/${id}`),
  previewDataset: (id: string, rows = 20) =>
    request<Preview>(`/api/datasets/${id}/preview?rows=${rows}`),
  deleteDataset: (id: string) =>
    request<{ success: boolean }>(`/api/datasets/${id}`, { method: 'DELETE' }),

  // 项目
  listProjects: (scope: 'mine' | 'public') =>
    request<Project[]>(`/api/projects?scope=${scope}`),
  createProject: (name: string, description: string, dataset_id: string) =>
    request<Project>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name, description, dataset_id }),
    }),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  updateProject: (id: string, name: string, description: string) =>
    request<Project>(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, description }),
    }),
  deleteProject: (id: string) =>
    request<{ success: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
  publishProject: (id: string, is_public: boolean) =>
    request<Project>(`/api/projects/${id}/publish`, {
      method: 'POST',
      body: JSON.stringify({ is_public }),
    }),
  cloneProject: (id: string) =>
    request<Project>(`/api/projects/${id}/clone`, { method: 'POST' }),

  // 血缘
  listAlgorithms: () => request<Algorithm[]>('/api/algorithms'),
  listNodes: (projectId: string) =>
    request<LineageNode[]>(`/api/projects/${projectId}/nodes`),
  getNode: (projectId: string, nodeId: string) =>
    request<LineageNode>(`/api/projects/${projectId}/nodes/${nodeId}`),
  previewNode: (projectId: string, nodeId: string, rows = 20) =>
    request<Preview>(`/api/projects/${projectId}/nodes/${nodeId}/preview?rows=${rows}`),
  runAlgorithm: (projectId: string, nodeId: string, algorithm: string, params: Record<string, unknown>) =>
    request<AlgorithmRun>(`/api/projects/${projectId}/nodes/${nodeId}/run`, {
      method: 'POST',
      body: JSON.stringify({ algorithm, params }),
    }),
  listRuns: (projectId: string) =>
    request<AlgorithmRun[]>(`/api/projects/${projectId}/runs`),
  getRun: (projectId: string, runId: string) =>
    request<AlgorithmRun>(`/api/projects/${projectId}/runs/${runId}`),
  reviewRun: (projectId: string, runId: string, decision: 'approve' | 'reject') =>
    request<AlgorithmRun>(`/api/projects/${projectId}/runs/${runId}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),
  deleteRun: (projectId: string, runId: string) =>
    request<{ success: boolean }>(`/api/projects/${projectId}/runs/${runId}`, {
      method: 'DELETE',
    }),
}
