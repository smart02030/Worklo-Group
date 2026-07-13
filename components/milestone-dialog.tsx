import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId?: string;
  projectId?: string;
};

/**
 * Lightweight placeholder component.
 *
 * The app references `MilestoneDialog` from `components/account-overview.tsx`.
 * The original implementation was removed from the repo; this keeps the UI/build
 * functional until milestone UX is restored.
 */
export function MilestoneDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Milestones</DialogTitle>
        </DialogHeader>
        <div className="text-muted-foreground text-sm">
          Milestone dialog is not yet configured for this build.
        </div>
      </DialogContent>
    </Dialog>
  );
}
