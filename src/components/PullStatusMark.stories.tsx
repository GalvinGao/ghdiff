import type { Meta, StoryObj } from '@storybook/react-vite';

import { PullStatusMark } from './PullStatusMark';
import { describePullStatus, type PullReviewStatus } from '@/lib/pullStatus';

const meta = {
  title: 'Review/Pull status',
  component: PullStatusMark,
  args: { size: 30, status: { review: 'approved', check: 'success' } },
} satisfies Meta<typeof PullStatusMark>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Approved: Story = {};
const statuses: PullReviewStatus[] = [
  { review: 'approved', check: 'success' },
  { review: 'changes', check: 'failure' },
  { review: 'changes', check: 'pending', commitsSinceChanges: true },
  { review: 'none', check: 'pending' },
  { review: 'none', check: 'none' },
];
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-4 p-4">
      {statuses.map((status) => (
        <div
          key={describePullStatus(status)}
          className="flex items-center gap-3 text-sm"
        >
          <PullStatusMark status={status} size={30} />
          <span>{describePullStatus(status)}</span>
        </div>
      ))}
    </div>
  ),
};
