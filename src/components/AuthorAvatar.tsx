import { cn } from '@/lib/cn';

// The account that wrote a comment, as a picture.
//
// A face, or a robot's logo, is read faster than a login, which is what makes a
// bot's wall of comments skippable at a glance. The login sits beside every one
// of these, so the picture adds nothing to a reader who cannot see it and is
// hidden from them.
//
// A bot's square is rounded a little rather than made round. An app's logo is
// drawn to fill a square, and a circle cuts its corners off; the two shapes are
// also the second thing that tells a person from an app in a mixed thread.

interface AuthorAvatarProps {
  /** The login, whose first letter stands in when there is no picture. */
  author: string;
  avatarUrl?: string;
  className?: string;
  isBot?: boolean;
  /** Side of the square, in pixels. */
  size: number;
}

export function AuthorAvatar({
  author,
  avatarUrl,
  className,
  isBot = false,
  size,
}: AuthorAvatarProps) {
  // The box is sized in the style attribute and not in a class, so a card that
  // has already picked its height cannot be resized by a picture that arrives
  // late or never arrives at all.
  const shared = cn(
    'border-line shrink-0 border object-cover',
    isBot ? 'rounded-sm' : 'rounded-full',
    className
  );
  const box = { height: size, width: size };

  if (avatarUrl != null) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className={shared}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        src={avatarUrl}
        style={box}
        width={size}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        shared,
        'bg-surface text-ink-faint flex items-center justify-center font-semibold uppercase'
      )}
      style={{ ...box, fontSize: Math.round(size * 0.5) }}
    >
      {author.slice(0, 1)}
    </span>
  );
}
