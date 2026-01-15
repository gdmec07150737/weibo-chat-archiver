
import React, { useMemo } from 'react';
import { ChatArchive } from '../types';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

interface AnalyticsProps {
  archives: ChatArchive[];
}

const COLORS = ['#6366f1', '#a855f7', '#ec4899', '#f97316', '#10b981', '#3b82f6'];

const Analytics: React.FC<AnalyticsProps> = ({ archives }) => {
  const stats = useMemo(() => {
    const allMessages = archives.flatMap(a => a.messages);
    
    // Message count by user
    const userStatsMap: Record<string, number> = {};
    allMessages.forEach(m => {
      userStatsMap[m.senderName] = (userStatsMap[m.senderName] || 0) + 1;
    });
    
    const userStats = Object.entries(userStatsMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Activity by hour
    const hourStatsMap: Record<string, number> = {};
    allMessages.forEach(m => {
      const hour = new Date(m.timestamp).getHours();
      const label = `${hour}:00`;
      hourStatsMap[label] = (hourStatsMap[label] || 0) + 1;
    });

    const hourStats = Array.from({ length: 24 }).map((_, i) => ({
      hour: `${i}:00`,
      count: hourStatsMap[`${i}:00`] || 0
    }));

    return { userStats, hourStats, totalMessages: allMessages.length };
  }, [archives]);

  if (archives.length === 0) {
    return <div className="text-center py-20 text-gray-500">导入数据后即可查看分析图表</div>;
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-400 uppercase tracking-widest mb-1">总消息量</p>
          <h3 className="text-4xl font-black text-indigo-600">{stats.totalMessages}</h3>
        </div>
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-400 uppercase tracking-widest mb-1">总备份次数</p>
          <h3 className="text-4xl font-black text-purple-600">{archives.length}</h3>
        </div>
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-400 uppercase tracking-widest mb-1">活跃参与者</p>
          <h3 className="text-4xl font-black text-emerald-600">{stats.userStats.length}</h3>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
          <h4 className="text-lg font-bold text-gray-900 mb-6">活跃用户排行 (TOP 10)</h4>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.userStats} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={80} axisLine={false} tickLine={false} style={{ fontSize: '12px' }} />
                <Tooltip 
                  cursor={{ fill: '#f9fafb' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
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
              <BarChart data={stats.hourStats}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="hour" axisLine={false} tickLine={false} style={{ fontSize: '10px' }} />
                <YAxis axisLine={false} tickLine={false} style={{ fontSize: '10px' }} />
                <Tooltip 
                  cursor={{ fill: '#f9fafb' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
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
