import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  CpuChipIcon,
  PhoneIcon,
  ChartBarIcon,
  PlusIcon,
  ArrowTrendingUpIcon,
  ClockIcon,
  SignalIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../hooks/useAuth';
import { useBrains, useBrainStats, useActiveBrain } from '../hooks/useBrains';
import { CardSkeleton } from '../components/Loading';
import { formatRelativeTime, truncateText } from '../lib/utils';

export function Dashboard() {
  const { user } = useAuth();
  const { data: brainsData, isLoading: brainsLoading } = useBrains({ limit: 5 });
  const { data: activeBrainData } = useActiveBrain();
  const stats = useBrainStats();

  const dashboardStats = [
    {
      name: 'Total AI Brains',
      value: stats.total,
      icon: CpuChipIcon,
      color: 'bg-blue-500',
      change: '+12%',
      changeType: 'increase' as const,
    },
    {
      name: 'Active Calls Today',
      value: '23',
      icon: PhoneIcon,
      color: 'bg-green-500',
      change: '+8%',
      changeType: 'increase' as const,
    },
    {
      name: 'Success Rate',
      value: '94.2%',
      icon: ChartBarIcon,
      color: 'bg-purple-500',
      change: '+2.4%',
      changeType: 'increase' as const,
    },
    {
      name: 'Avg Call Duration',
      value: '3:42',
      icon: ClockIcon,
      color: 'bg-orange-500',
      change: '-0.8%',
      changeType: 'decrease' as const,
    },
  ];

  const recentActivity = [
    {
      id: 1,
      type: 'call',
      title: 'Customer Support Call Completed',
      description: 'Successfully handled customer inquiry about billing',
      time: '2 minutes ago',
      status: 'success',
    },
    {
      id: 2,
      type: 'brain',
      title: 'Sales Agent Brain Updated',
      description: 'Enhanced personality instructions for better conversion',
      time: '1 hour ago',
      status: 'info',
    },
    {
      id: 3,
      type: 'call',
      title: 'High-Priority Call Escalated',
      description: 'Technical issue call transferred to human agent',
      time: '3 hours ago',
      status: 'warning',
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Welcome back, {user?.name?.split(' ')[0]}! 👋
          </h1>
          <p className="text-gray-600 mt-1">
            Here's what's happening with your AI calling agents today.
          </p>
        </div>
        <Link
          to="/brains"
          className="btn btn-primary"
        >
          <PlusIcon className="w-5 h-5 mr-2" />
          Create AI Brain
        </Link>
      </motion.div>

      {/* Stats Grid */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
      >
        {dashboardStats.map((stat, index) => (
          <motion.div
            key={stat.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + index * 0.05 }}
            className="card-hover"
          >
            <div className="flex items-center">
              <div className={`p-3 rounded-lg ${stat.color}`}>
                <stat.icon className="w-6 h-6 text-white" />
              </div>
              <div className="ml-4 flex-1">
                <p className="text-sm font-medium text-gray-600">{stat.name}</p>
                <div className="flex items-center">
                  <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                  <span
                    className={`ml-2 text-sm font-medium flex items-center ${
                      stat.changeType === 'increase'
                        ? 'text-green-600'
                        : 'text-red-600'
                    }`}
                  >
                    <ArrowTrendingUpIcon
                      className={`w-4 h-4 mr-1 ${
                        stat.changeType === 'decrease' ? 'rotate-180' : ''
                      }`}
                    />
                    {stat.change}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Brain */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="lg:col-span-2"
        >
          <div className="card">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">Active AI Brain</h2>
              <Link to="/brains" className="btn btn-ghost btn-sm">
                View All
              </Link>
            </div>

            {activeBrainData?.data.brain ? (
              <div className="bg-gradient-to-r from-primary-50 to-blue-50 rounded-xl p-6 border border-primary-100">
                <div className="flex items-start space-x-4">
                  <div className="p-3 bg-primary-600 rounded-lg">
                    <CpuChipIcon className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      {activeBrainData.data.brain.name}
                    </h3>
                    <p className="text-gray-600 mb-3">
                      {truncateText(activeBrainData.data.brain.instructions, 120)}
                    </p>
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <span className="flex items-center">
                        <SignalIcon className="w-4 h-4 mr-1" />
                        Active
                      </span>
                      <span>
                        Updated {formatRelativeTime(activeBrainData.data.brain.updatedAt)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                <CpuChipIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Active Brain</h3>
                <p className="text-gray-600 mb-4">
                  Create your first AI brain to start handling calls automatically.
                </p>
                <Link to="/brains" className="btn btn-primary">
                  Create AI Brain
                </Link>
              </div>
            )}
          </div>
        </motion.div>

        {/* Recent Activity */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Recent Activity</h2>
            <div className="space-y-4">
              {recentActivity.map((activity, index) => (
                <motion.div
                  key={activity.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                  className="flex items-start space-x-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div
                    className={`p-2 rounded-lg ${
                      activity.status === 'success'
                        ? 'bg-green-100 text-green-600'
                        : activity.status === 'warning'
                        ? 'bg-orange-100 text-orange-600'
                        : 'bg-blue-100 text-blue-600'
                    }`}
                  >
                    {activity.type === 'call' ? (
                      <PhoneIcon className="w-4 h-4" />
                    ) : (
                      <CpuChipIcon className="w-4 h-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {activity.title}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {activity.description}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">{activity.time}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Recent Brains */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Recent AI Brains</h2>
            <Link to="/brains" className="btn btn-ghost btn-sm">
              View All
            </Link>
          </div>

          {brainsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : brainsData?.data.brains.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {brainsData.data.brains.map((brain, index) => (
                <motion.div
                  key={brain._id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + index * 0.1 }}
                  className="p-4 border border-gray-200 rounded-lg hover:border-primary-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center space-x-3 mb-3">
                    <div className="p-2 bg-primary-100 rounded-lg">
                      <CpuChipIcon className="w-5 h-5 text-primary-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium text-gray-900">{brain.name}</h3>
                      <div className="flex items-center space-x-2 mt-1">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            brain.isActive
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {brain.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">
                    {truncateText(brain.instructions, 80)}
                  </p>
                  <div className="text-xs text-gray-500">
                    Updated {formatRelativeTime(brain.updatedAt)}
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <CpuChipIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No AI Brains Yet</h3>
              <p className="text-gray-600 mb-4">
                Get started by creating your first AI calling agent.
              </p>
              <Link to="/brains" className="btn btn-primary">
                Create Your First Brain
              </Link>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
