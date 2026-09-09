import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from './Button';
import { Dialog, dialogPrimaryAction } from './Dialog';

function DialogFixture({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Review ready">
        <p className="text-ink-muted mb-4 text-sm">
          A local fixture for capturing dialog motion and keyboard interaction.
        </p>
        <Button
          variant="solid"
          {...dialogPrimaryAction}
          onClick={() => setOpen(false)}
        >
          Done
        </Button>
      </Dialog>
    </>
  );
}
const meta = {
  title: 'UI/Dialog',
  component: DialogFixture,
} satisfies Meta<typeof DialogFixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Interaction: Story = {};
export const Open: Story = { args: { initiallyOpen: true } };
