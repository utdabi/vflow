// components/SidebarNav.tsx
// Permanent left-rail navigation for tablets (width >= 768dp).
// Shows: Home · Shifts · Volunteers + Sign out at bottom.

import { View, Text, TouchableOpacity, Image } from 'react-native'
import { usePathname, router } from 'expo-router'
import { useAuth } from '../lib/auth-context'

const NAV_ITEMS = [
  { label: 'Home',       route: '/(app)/' as const,             icon: '🏠' },
  { label: 'Shifts',     route: '/(app)/shifts/' as const,      icon: '📅' },
  { label: 'Volunteers', route: '/(app)/volunteers/' as const,  icon: '👥' },
]

export default function SidebarNav() {
  const pathname = usePathname()
  const { signOut, organization } = useAuth()

  return (
    <View className="w-52 bg-white border-r border-gray-200 flex flex-col py-4">
      {/* Brand */}
      <View className="px-4 mb-6 items-center">
        {organization?.logo_url ? (
          <Image
            source={{ uri: organization.logo_url }}
            style={{ width: 64, height: 64, borderRadius: 8 }}
            resizeMode="contain"
          />
        ) : (
          <View className="w-16 h-16 bg-blue-600 rounded-lg items-center justify-center">
            <Text className="text-white text-2xl font-bold">VF</Text>
          </View>
        )}
        {organization?.name
          ? <Text className="text-sm font-bold text-gray-900 mt-2" numberOfLines={1}>{organization.name}</Text>
          : <Text className="text-sm font-bold text-blue-600 mt-2">VolunteerFlow</Text>
        }
        <Text className="text-xs text-gray-400 mt-0.5">Coordinator</Text>
      </View>

      {/* Nav items */}
      <View className="flex-1">
        {NAV_ITEMS.map(({ label, route, icon }) => {
          const active = pathname === route || pathname.startsWith(route.replace('/', ''))
          return (
            <TouchableOpacity
              key={route}
              onPress={() => router.push(route)}
              className={`flex-row items-center gap-3 px-4 py-3 mx-2 rounded-lg mb-0.5 ${
                active ? 'bg-blue-50' : 'hover:bg-gray-50'
              }`}
              activeOpacity={0.7}
            >
              <Text className="text-base">{icon}</Text>
              <Text className={`text-sm font-medium ${active ? 'text-blue-700' : 'text-gray-700'}`}>
                {label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* Sign out */}
      <TouchableOpacity
        onPress={signOut}
        className="flex-row items-center gap-3 px-4 py-3 mx-2 rounded-lg"
        activeOpacity={0.7}
      >
        <Text className="text-base">↪</Text>
        <Text className="text-sm font-medium text-gray-500">Sign out</Text>
      </TouchableOpacity>
    </View>
  )
}
