// app/(app)/index.tsx
// Home screen — welcome message + three quick-action tiles.

import { View, Text, TouchableOpacity, ScrollView } from 'react-native'
import { router } from 'expo-router'
import { useAuth } from '../../lib/auth-context'

interface Tile {
  icon:    string
  title:   string
  subtitle: string
  onPress: () => void
}

export default function HomeScreen() {
  const { user } = useAuth()
  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? 'Coordinator'

  const tiles: Tile[] = [
    {
      icon: '👥',
      title: 'Volunteers',
      subtitle: 'View and manage your volunteer list',
      onPress: () => router.push('/(app)/volunteers/'),
    },
    {
      icon: '📅',
      title: 'Shifts',
      subtitle: 'Browse the monthly shift calendar',
      onPress: () => router.push('/(app)/shifts/'),
    },
    {
      icon: '➕',
      title: 'Add Volunteer',
      subtitle: 'Quickly register a new volunteer',
      onPress: () => router.push('/(app)/volunteers/new'),
    },
  ]

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerClassName="p-6">
      {/* Welcome */}
      <Text className="text-2xl font-bold text-gray-900 mb-1">
        Welcome, {fullName}! 👋
      </Text>
      <Text className="text-base text-gray-500 mb-8">
        Your VolunteerFlow account is ready.
      </Text>

      {/* Quick-action tiles */}
      <View className="flex-row flex-wrap gap-4">
        {tiles.map((tile) => (
          <TouchableOpacity
            key={tile.title}
            onPress={tile.onPress}
            activeOpacity={0.85}
            className="flex-1 min-w-[140px] bg-white rounded-2xl shadow-sm p-5 border border-gray-100"
          >
            <Text className="text-3xl mb-3">{tile.icon}</Text>
            <Text className="text-base font-semibold text-gray-900 mb-1">{tile.title}</Text>
            <Text className="text-xs text-gray-500">{tile.subtitle}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Support */}
      <Text className="mt-10 text-xs text-gray-400 text-center">
        Questions? Contact{' '}
        <Text className="text-blue-600">support@volunteerflow.com</Text>
      </Text>
    </ScrollView>
  )
}
