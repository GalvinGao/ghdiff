import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from './Button';

const meta = {
  title: 'UI/Button',
  component: Button,
  args: { children: 'Review', variant: 'solid' },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <Button variant="solid">Review</Button>
      <Button>Cancel</Button>
      <Button variant="danger">Remove</Button>
      <Button variant="quiet">More</Button>
      <Button variant="chrome">Display</Button>
      <Button disabled>Unavailable</Button>
    </div>
  ),
};
