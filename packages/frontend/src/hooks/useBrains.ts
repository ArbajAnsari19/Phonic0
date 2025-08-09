import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { brainApi } from '../lib/api';
import toast from 'react-hot-toast';

export function useBrains(params?: { active?: boolean; limit?: number; page?: number }) {
  return useQuery({
    queryKey: ['brains', params],
    queryFn: () => brainApi.getAll(params),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useBrain(id: string) {
  return useQuery({
    queryKey: ['brain', id],
    queryFn: () => brainApi.getById(id),
    enabled: !!id,
  });
}

export function useActiveBrain() {
  return useQuery({
    queryKey: ['brain', 'active'],
    queryFn: () => brainApi.getActive(),
    retry: false, // Don't retry if no active brain
  });
}

export function useCreateBrain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: brainApi.create,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['brains'] });
      queryClient.invalidateQueries({ queryKey: ['brain', 'active'] });
      toast.success(`Brain "${data.data.brain.name}" created successfully!`);
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || 'Failed to create brain';
      toast.error(message);
    },
  });
}

export function useUpdateBrain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof brainApi.update>[1] }) =>
      brainApi.update(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['brains'] });
      queryClient.invalidateQueries({ queryKey: ['brain', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['brain', 'active'] });
      toast.success(`Brain "${data.data.brain.name}" updated successfully!`);
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || 'Failed to update brain';
      toast.error(message);
    },
  });
}

export function useDeleteBrain() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: brainApi.delete,
    onSuccess: (_, brainId) => {
      queryClient.invalidateQueries({ queryKey: ['brains'] });
      queryClient.invalidateQueries({ queryKey: ['brain', 'active'] });
      queryClient.removeQueries({ queryKey: ['brain', brainId] });
      toast.success('Brain deleted successfully!');
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || 'Failed to delete brain';
      toast.error(message);
    },
  });
}

// Hook to get brain statistics
export function useBrainStats() {
  const { data: brainsData } = useBrains();
  const { data: activeBrainData } = useActiveBrain();

  const stats = {
    total: brainsData?.data.brains.length || 0,
    active: brainsData?.data.brains.filter(brain => brain.isActive).length || 0,
    inactive: brainsData?.data.brains.filter(brain => !brain.isActive).length || 0,
    activeBrain: activeBrainData?.data.brain || null,
  };

  return stats;
}
