// app/(app)/shifts/_layout.tsx
// Stack navigator for the shifts route group.
// index.tsx → new.tsx and index.tsx → [id].tsx are proper push/pop navigations.
import { Stack } from 'expo-router'

export default function ShiftsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
