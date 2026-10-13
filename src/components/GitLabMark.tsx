import type { SVGProps } from 'react';

// The GitLab tanuki, as one inline SVG and no dependency. @pierre/icons ships
// 371 icons and no GitLab one, so the mark is drawn here in `currentColor`,
// the same way `IconBrandGithub` answers for GitHub. The path is Simple
// Icons' monochrome rendering of the mark (CC0), coordinates rounded to two
// decimals the way SVGO would — a fifth of a unit at this viewBox, invisible
// at icon sizes. GitLab's brand guidelines permit the mark for "works with
// GitLab" integration points, which the places that draw it — the account
// control, the setup connect button, the account panel — are.
export function GitLabMark({
  size = 16,
  ...props
}: { size?: number | string } & Omit<
  SVGProps<SVGSVGElement>,
  'children' | 'viewBox'
>) {
  return (
    <svg
      fill="currentColor"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="m23.6 9.59-.03-.09L20.3.98a.85.85 0 0 0-.34-.41.87.87 0 0 0-1 .05.87.87 0 0 0-.29.44l-2.21 6.75H7.54l-2.21-6.75a.86.86 0 0 0-.29-.44.87.87 0 0 0-1-.05.86.86 0 0 0-.34.4L.43 9.5l-.03.09a6.07 6.07 0 0 0 2.01 7.01l.01.01.03.02 4.98 3.73 2.46 1.86 1.5 1.13a1.01 1.01 0 0 0 1.22 0l1.5-1.13 2.46-1.86 5.01-3.75.01-.01a6.07 6.07 0 0 0 2.01-7z" />
    </svg>
  );
}
