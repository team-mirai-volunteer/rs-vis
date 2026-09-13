import { Loader2 } from 'lucide-react';

export default function LoadingSpinner() {
  return (
    <div className="flex h-64 items-center justify-center" role="status" aria-label="読み込み中">
      <Loader2 className="size-10 animate-spin text-primary" aria-hidden="true" />
    </div>
  );
}
