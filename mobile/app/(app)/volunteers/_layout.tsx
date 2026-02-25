// app/(app)/volunteers/_layout.tsx
// Stack navigator for the volunteers route group.
// Gives index.tsx → new.tsx proper push/pop navigation on both tablet and phone.
import { Stack } from 'expo-router'

export default function VolunteersLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
