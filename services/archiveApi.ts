import type {
  ChatDayStat,
  ChatGroupSummary,
  GroupStats,
  MessagePage,
  OverallStats,
  SearchPage,
} from "../types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchGroups(): Promise<ChatGroupSummary[]> {
  const data = await getJson<{ groups: ChatGroupSummary[] }>("/api/groups");
  return data.groups || [];
}

export async function fetchGroupDays(groupId: string): Promise<ChatDayStat[]> {
  const data = await getJson<{ days: ChatDayStat[] }>(
    `/api/groups/${encodeURIComponent(groupId)}/days`
  );
  return data.days || [];
}

export async function fetchMessages(params: {
  groupId: string;
  limit?: number;
  cursor?: string | null;
  direction?: "older" | "newer";
  date?: string | null;
  aroundId?: string | null;
}): Promise<MessagePage> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.direction) qs.set("direction", params.direction);
  if (params.date) qs.set("date", params.date);
  if (params.aroundId) qs.set("aroundId", params.aroundId);
  const q = qs.toString();
  return getJson<MessagePage>(
    `/api/groups/${encodeURIComponent(params.groupId)}/messages${q ? `?${q}` : ""}`
  );
}

export async function searchGroupMessages(params: {
  groupId: string;
  q?: string;
  sender?: string;
  cursor?: string | null;
  limit?: number;
}): Promise<SearchPage> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.sender) qs.set("sender", params.sender);
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.limit) qs.set("limit", String(params.limit));
  return getJson<SearchPage>(
    `/api/groups/${encodeURIComponent(params.groupId)}/search?${qs.toString()}`
  );
}

export async function fetchGroupStats(groupId: string): Promise<GroupStats> {
  return getJson<GroupStats>(`/api/groups/${encodeURIComponent(groupId)}/stats`);
}

export async function fetchOverallStats(): Promise<OverallStats> {
  return getJson<OverallStats>("/api/stats");
}

export async function uploadBackup(payload: {
  groupId: string;
  messages: any[];
}): Promise<{ success: boolean; affected: number }> {
  const res = await fetch("/api/backup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Backup upload failed: ${res.status}`);
  }
  return res.json();
}
