// app/(app)/_layout.tsx
// Root layout for authenticated screens.
// Tablet (>= 768dp): permanent sidebar + Slot content area side-by-side.
// Narrow (<768dp): bottom tab bar fallback.
// AuthProvider wraps everything; unauthenticated users are redirected to login.

import { useEffect } from 'react'
import { View, useWindowDimensions } from 'react-native'
import { Slot, Tabs, router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '../../lib/auth-context'
import SidebarNav from '../../components/SidebarNav'
import '../../../global.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 60 * 5, retry: 1 } },
})

function AppShell() {
  const { width } = useWindowDimensions()
  const isTablet = width >= 768
  const { user, loading } = useAuth()

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/(auth)/login')
    }
  }, [user, loading])

  if (loading || !user) return null

  if (isTablet) {
    return (
      <SafeAreaView className="flex-1 flex-row bg-gray-50" edges={['top', 'bottom']}>
        <SidebarNav />
        <View className="flex-1">
          <Slot />
        </View>
      </SafeAreaView>
    )
  }

  // Narrow fallback: bottom tabs
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#2563EB',
        tabBarStyle: { borderTopColor: '#E5E7EB' },
      }}
    >
      <Tabs.Screen name="index"      options={{ title: 'Home',       tabBarLabel: 'Home'       }} />
      <Tabs.Screen name="shifts"     options={{ title: 'Shifts',     tabBarLabel: 'Shifts'     }} />
      <Tabs.Screen name="volunteers" options={{ title: 'Volunteers', tabBarLabel: 'Volunteers' }} />
    </Tabs>
  )
}

export default function AppLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </QueryClientProvider>
  )
}
