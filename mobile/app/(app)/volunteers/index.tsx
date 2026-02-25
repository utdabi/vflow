// app/(app)/volunteers/index.tsx — Phase 2
// Volunteer list with search, active/inactive toggle, and swipe-to-deactivate.
import { useState, useCallback } from 'react'
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, Pressable,
} from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Swipeable } from 'react-native-gesture-handler'
import { router } from 'expo-router'
import { volunteersApi, type Volunteer } from '../../../lib/api'

const DAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export default function VolunteersScreen() {
  const queryClient = useQueryClient()
  const [activeFilter, setActiveFilter] = useState(true)
  const [search, setSearch] = useState('')

  const { data: volunteers = [], isLoading, error, refetch } = useQuery({
    queryKey: ['volunteers', activeFilter],
    queryFn: () => volunteersApi.list(activeFilter).then(r => r.data),
  })

  const filtered = volunteers.filter(v => {
    const q = search.toLowerCase()
    return (
      v.first_name.toLowerCase().includes(q) ||
      v.last_name.toLowerCase().includes(q) ||
      v.mobile.includes(q) ||
      (v.email ?? '').toLowerCase().includes(q)
    )
  })

  const handleDeactivate = useCallback((v: Volunteer) => {
    Alert.alert(
      'Mark Inactive',
      `Mark ${v.first_name} ${v.last_name} as inactive? Their history will be kept and they can be reactivated later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Inactive',
          style: 'destructive',
          onPress: async () => {
            try {
              await volunteersApi.deactivate(v.id)
              queryClient.invalidateQueries({ queryKey: ['volunteers'] })
            } catch {
              Alert.alert('Error', 'Failed to mark volunteer as inactive.')
            }
          },
        },
      ],
    )
  }, [queryClient])

  const handleReactivate = useCallback((v: Volunteer) => {
    Alert.alert(
      'Reactivate Volunteer',
      `Reactivate ${v.first_name} ${v.last_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reactivate',
          onPress: async () => {
            try {
              await volunteersApi.update(v.id, { active: true })
              queryClient.invalidateQueries({ queryKey: ['volunteers'] })
            } catch {
              Alert.alert('Error', 'Failed to reactivate volunteer.')
            }
          },
        },
      ],
    )
  }, [queryClient])

  const renderItem = ({ item: v }: { item: Volunteer }) => (
    <Swipeable
      renderRightActions={activeFilter ? () => (
        <TouchableOpacity
          className="bg-amber-500 justify-center items-center w-24"
          onPress={() => handleDeactivate(v)}
        >
          <Text className="text-white text-sm font-semibold">Inactive</Text>
        </TouchableOpacity>
      ) : undefined}
      renderLeftActions={!activeFilter ? () => (
        <TouchableOpacity
          className="bg-green-500 justify-center items-center w-24"
          onPress={() => handleReactivate(v)}
        >
          <Text className="text-white text-sm font-semibold">Reactivate</Text>
        </TouchableOpacity>
      ) : undefined}
    >
      <View className="bg-white px-4 py-3 border-b border-gray-100">
        <View className="flex-row items-start justify-between">
          <View className="flex-1 mr-3">
            <Text className="text-base font-semibold text-gray-900">
              {v.first_name} {v.last_name}
            </Text>
            <Text className="text-sm text-gray-500 mt-0.5">{v.mobile}</Text>
            {v.email ? (
              <Text className="text-xs text-gray-400 mt-0.5">{v.email}</Text>
            ) : null}
          </View>
          <View className="items-end">
            {v.preferred_days.length > 0 && (
              <View className="flex-row flex-wrap justify-end mb-1" style={{ gap: 2 }}>
                {[...v.preferred_days].sort((a, b) => a - b).map(d => (
                  <View key={d} className="bg-blue-50 border border-blue-100 rounded px-1 py-0.5">
                    <Text className="text-blue-600 text-xs">{DAY_SHORT[d]}</Text>
                  </View>
                ))}
              </View>
            )}
            {v.skills.length > 0 && (
              <Text className="text-xs text-gray-400">
                {v.skills.slice(0, 2).join(', ')}{v.skills.length > 2 ? '…' : ''}
              </Text>
            )}
          </View>
        </View>
      </View>
    </Swipeable>
  )

  return (
    <View className="flex-1 bg-gray-50">
      {/* Header */}
      <View className="bg-white border-b border-gray-200 px-4 pt-4 pb-3">
        <Text className="text-2xl font-bold text-gray-900 mb-3">Volunteers</Text>

        {/* Search */}
        <TextInput
          className="bg-gray-100 rounded-lg px-3 py-2.5 text-sm text-gray-900 mb-3"
          placeholder="Search by name, mobile or email…"
          placeholderTextColor="#9ca3af"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
        />

        {/* Active / Inactive toggle */}
        <View className="flex-row rounded-lg border border-gray-200 overflow-hidden self-start">
          <Pressable
            onPress={() => setActiveFilter(true)}
            className={`px-5 py-2 ${activeFilter ? 'bg-blue-600' : 'bg-white'}`}
          >
            <Text className={`text-sm font-medium ${activeFilter ? 'text-white' : 'text-gray-600'}`}>
              Active
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveFilter(false)}
            className={`px-5 py-2 border-l border-gray-200 ${!activeFilter ? 'bg-blue-600' : 'bg-white'}`}
          >
            <Text className={`text-sm font-medium ${!activeFilter ? 'text-white' : 'text-gray-600'}`}>
              Inactive
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Count */}
      {!isLoading && (
        <Text className="text-sm text-gray-500 px-4 py-2">
          <Text className="font-semibold text-gray-700">{filtered.length}</Text>
          {' '}{activeFilter ? 'active' : 'inactive'} volunteer{filtered.length !== 1 ? 's' : ''}
          {search.trim() ? ` matching "${search.trim()}"` : ''}
        </Text>
      )}

      {/* List / States */}
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 48 }} size="large" color="#2563eb" />
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-red-600 text-center mb-3">Failed to load volunteers.</Text>
          <TouchableOpacity
            onPress={() => refetch()}
            className="px-4 py-2 bg-blue-600 rounded-lg"
          >
            <Text className="text-white text-sm font-medium">Retry</Text>
          </TouchableOpacity>
        </View>
      ) : filtered.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-gray-400 text-center text-base">
            {search
              ? 'No volunteers match your search.'
              : activeFilter
              ? 'No active volunteers yet.\nTap + to add your first volunteer.'
              : 'No inactive volunteers.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={v => v.id}
          renderItem={renderItem}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 100 }}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        onPress={() => router.push('/(app)/volunteers/new')}
        className="absolute bottom-6 right-6 w-14 h-14 bg-blue-600 rounded-full items-center justify-center"
        style={{
          elevation: 6,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.2,
          shadowRadius: 4,
        }}
      >
        <Text className="text-white text-3xl font-light" style={{ lineHeight: 42, marginTop: -2 }}>
          +
        </Text>
      </TouchableOpacity>
    </View>
  )
}
