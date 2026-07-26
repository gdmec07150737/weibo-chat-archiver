import React, { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Loader2 } from "lucide-react";
import type { ChatGroupSummary, GroupStats, OverallStats } from "../types";
import { fetchGroupStats, fetchOverallStats } from "../services/archiveApi";

interface AnalyticsProps {
  groups: ChatGroupSummary[];
  selectedGroupId?: string | null;
}

const Analytics: React.FC<AnalyticsProps> = ({ groups, selectedGroupId }) => {
  const [groupId, setGroupId] = useState<string>(selectedGroupId || groups[0]?.groupId || "");
  const [overall, setOverall] = useState<OverallStats | null>(null);
  const [groupStats, setGroupStats] = useState<GroupStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedGroupId) setGroupId(selectedGroupId);
    else if (!groupId && groups[0]?.groupId) setGroupId(groups[0].groupId);
  }, [selectedGroupId, groups, groupId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const o = await fetchOverallStats();
        if (cancelled) return;
        setOverall(o);
        if (groupId) {
          const g = await fetchGroupStats(groupId);
          if (!cancelled) setGroupStats(g);
        } else {
          setGroupStats(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "统计加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-indigo-500 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> 正在从 MySQL 聚合统计...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-20 text-rose-500 text-sm">{error}</div>;
  }

  if (!overall || overall.totalMessages === 0) {
    return (
      <div className="text-center py-20 text-gray-500">
        暂无数据。采集写入 MySQL 后即可查看服务端统计。
      </div>
    );
  }

  const chartBySender = groupStats?.bySender?.length
    ? groupStats.bySender.slice(0, 10)
    : overall.bySender;
  const chartByHour = groupStats?.byHour?.length ? groupStats.byHour : overall.byHour;

  return (
    <div className="space-y-8">
      {groups.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="text-sm font-semibold text-gray-600">统计范围</label>
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm"
          >
            {groups.map((g) => (
              <option key={g.groupId} value={g.groupId}>
                {g.title} ({g.messageCount.toLocaleString()})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-400 uppercase tracking-widest mb-1">
            {groupStats ? "本群消息" : "总消息量"}
          </p>
          <h3 className="text-4xl font-black text-indigo-600">
            {(groupStats?.totalMessages ?? overall.totalMessages).toLocaleString()}
          </h3>
        </div>
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-400 uppercase tracking-widest mb-1">
            {groupStats ? "覆盖天数" : "群数量"}
          </p>
          <h3 className="text-4xl font-black text-purple-600">
            {(groupStats?.dayCount ?? overall.groupCount).toLocaleString()}
          </h3>
        </div>
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-400 uppercase tracking-widest mb-1">
            活跃参与者
          </p>
          <h3 className="text-4xl font-black text-emerald-600">
            {(groupStats?.senderCount ?? overall.senderCount).toLocaleString()}
          </h3>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
          <h4 className="text-lg font-bold text-gray-900 mb-6">活跃用户排行 (TOP 10)</h4>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartBySender} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                <XAxis type="number" hide />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={80}
                  axisLine={false}
                  tickLine={false}
                  style={{ fontSize: "12px" }}
                />
                <Tooltip
                  cursor={{ fill: "#f9fafb" }}
                  contentStyle={{
                    borderRadius: "12px",
                    border: "none",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                />
                <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
          <h4 className="text-lg font-bold text-gray-900 mb-6">全天活跃时段分布</h4>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartByHour}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis
                  dataKey="hour"
                  axisLine={false}
                  tickLine={false}
                  style={{ fontSize: "10px" }}
                />
                <YAxis axisLine={false} tickLine={false} style={{ fontSize: "10px" }} />
                <Tooltip
                  cursor={{ fill: "#f9fafb" }}
                  contentStyle={{
                    borderRadius: "12px",
                    border: "none",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                />
                <Bar dataKey="count" fill="#a855f7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Analytics;
