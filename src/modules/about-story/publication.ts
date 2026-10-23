import { BadRequestException } from '@nestjs/common';
import { chapterKeys } from './dto.js';
import type { aboutCustomerStories, aboutMilestones, aboutStoryAssets, aboutStorySections } from '../../database/schema/about-story.js';

type Section = typeof aboutStorySections.$inferSelect;
type Milestone = typeof aboutMilestones.$inferSelect;
type Story = typeof aboutCustomerStories.$inferSelect;
type Asset = typeof aboutStoryAssets.$inferSelect;

/** Public projection of the single current record. Legacy approval columns are ignored. */
export function buildPublication(sections: Section[], milestones: Milestone[], stories: Story[], assets: Asset[]) {
  const imageFor = (type: Asset['ownerType'], key: string) => assets
    .filter(a => a.ownerType === type && a.ownerKey === key && a.altText.trim())
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map(a => ({ id: a.id, url: a.publicUrl, width: a.width, height: a.height, alt: a.altText, placement: a.placement }));
  if (sections.length !== 5 || new Set(sections.map(s => s.chapterKey)).size !== 5 ||
      chapterKeys.some(key => !sections.some(s => s.chapterKey === key && s.title.trim())))
    throw new BadRequestException('Five chapters with titles are required');
  const chapters = chapterKeys.map(key => {
    const s = sections.find(row => row.chapterKey === key)!;
    if (Boolean(s.ctaLabel?.trim()) !== Boolean(s.ctaHref?.trim()))
      throw new BadRequestException(`Incomplete CTA in ${key}`);
    return { key, title: s.title, subtitle: s.subtitle, body: s.body, ctaLabel: s.ctaLabel,
      ctaHref: s.ctaHref, visible: s.visible, images: imageFor('section', key) };
  });
  const order = <T extends { sortOrder: number; id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  return {
    chapters,
    milestones: order(milestones).map(m => ({ id: m.id, slug: m.slug, periodLabel: m.periodLabel,
      eventDate: m.eventDate, stage: m.stage, title: m.title, summary: m.summary, body: m.body,
      featured: m.featured, images: imageFor('milestone', m.id) })),
    stories: order(stories).map(s => ({ id: s.id, title: s.title, body: s.body, quote: s.quote,
      displayName: s.displayName, images: imageFor('story', s.id) })),
  };
}
