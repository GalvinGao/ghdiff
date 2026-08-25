import { createFileRoute } from '@tanstack/react-router';

import { HomeScreen } from '@/components/HomeScreen';

export const Route = createFileRoute('/')({
  component: HomeScreen,
});
