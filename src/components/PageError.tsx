import { m } from '../paraglide/messages.js';
import { Button } from '@/components/ui/Button';

export function PageError() {
  return (
    <main className="bg-surface flex flex-1 items-center justify-center p-8">
      <div className="max-w-md text-center" role="alert">
        <p className="text-ink text-sm text-pretty">{m.app_render_error()}</p>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          {m.review_status_panel_try_again()}
        </Button>
      </div>
    </main>
  );
}
