import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import type { SiteSlide } from '../../lib/home';
import type { SitePageImage } from '../../lib/pages';
import { usePageMediaPath } from '../../lib/pageMedia';
import { faNumber } from '../../lib/format';

/**
 * v12 phase 10e: the home page's «اسلایدر» and «بنر». The slider is a row the browser itself scrolls and snaps, so it
 * works by a swipe before any script has loaded and needs no library; the arrows and dots only ask the browser to
 * scroll. It never moves by itself. The first slide's image is loaded early (it is the largest thing on the page) and
 * every image has its box kept from the start, so nothing jumps. A phone's upright screen gets the other crop when the
 * shop chose one.
 */
function WideImage({ image, mobile, eager }: { image: SitePageImage; mobile: SitePageImage | null; eager: boolean }) {
  const media = usePageMediaPath();
  const [width, height] = [image.width ?? 1600, image.height ?? 600];
  return (
    <picture>
      {mobile ? <source media="(max-width: 639px)" srcSet={media(mobile.sha256)} width={mobile.width ?? 800} height={mobile.height ?? 1000} /> : null}
      <img
        src={media(image.sha256)} alt={image.alt} width={width} height={height} loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : undefined} decoding="async"
        className="block h-auto max-h-[78vh] w-full bg-muted object-cover"
      />
    </picture>
  );
}

function SlideLink({ slide, className, children }: { slide: Pick<SiteSlide, 'href' | 'external'>; className: string; children: React.ReactNode }) {
  return slide.external
    ? <a href={slide.href} rel="noopener noreferrer" className={className}>{children}</a>
    : <Link to={slide.href} className={className}>{children}</Link>;
}

export function HomeSlider({ slides, heading }: { slides: readonly SiteSlide[]; /** the first slide's title is the page's `<h1>` */ heading: boolean }) {
  const track = useRef<HTMLUListElement>(null);
  const [current, setCurrent] = useState(0);
  const many = slides.length > 1;
  // the slide most in view is the current one, however the visitor got there (a swipe, an arrow, a dot, the keyboard)
  useEffect(() => {
    const list = track.current;
    if (!list || !many || typeof IntersectionObserver === 'undefined') return undefined;
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) setCurrent(Number((entry.target as HTMLElement).dataset.slide));
    }, { root: list, threshold: 0.6 });
    for (const item of Array.from(list.children)) seen.observe(item);
    return () => seen.disconnect();
  }, [many, slides.length]);
  const go = (index: number) => {
    const item = track.current?.children[(index + slides.length) % slides.length] as HTMLElement | undefined;
    const still = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    item?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', inline: 'start', block: 'nearest' });
  };
  const arrow = 'absolute top-1/2 z-10 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-card/90 text-foreground shadow hover:bg-card sm:inline-flex';
  return (
    <section aria-roledescription="carousel" aria-label="اسلایدهای صفحهٔ اصلی" className="relative border-b border-border bg-muted" data-home-part="slider">
      <ul ref={track} className="scrollbar-none flex snap-x snap-mandatory overflow-x-auto" tabIndex={many ? 0 : undefined}>
        {slides.map((slide, index) => {
          const Title = heading && index === 0 ? 'h1' : 'p';
          return (
            <li key={index} data-slide={index} aria-roledescription="slide" aria-label={many ? `${faNumber(index + 1)} از ${faNumber(slides.length)}` : undefined} className="relative w-full shrink-0 snap-start">
              <WideImage image={slide.image} mobile={slide.mobileImage} eager={index === 0} />
              {slide.title || slide.text || slide.buttonLabel ? (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/45 to-transparent px-4 pb-10 pt-16 text-white sm:px-8 lg:px-16 lg:pb-14">
                  <div className="mx-auto max-w-7xl">
                    {slide.title ? <Title className="max-w-2xl text-2xl font-extrabold leading-tight text-balance break-words sm:text-4xl lg:text-5xl">{slide.title}</Title> : null}
                    {slide.text ? <p className="mt-2 max-w-xl leading-8 break-words lg:mt-3 lg:text-lg">{slide.text}</p> : null}
                    {slide.buttonLabel ? (
                      <SlideLink slide={slide} className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-control bg-white px-6 text-lg font-bold text-neutral-900 hover:bg-white/90">
                        {slide.buttonLabel}<ArrowLeft className="size-5" aria-hidden />
                      </SlideLink>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {many ? (
        <>
          <button type="button" className={`${arrow} right-3`} aria-label="اسلاید قبلی" onClick={() => go(current - 1)}><ChevronRight className="size-6" aria-hidden /></button>
          <button type="button" className={`${arrow} left-3`} aria-label="اسلاید بعدی" onClick={() => go(current + 1)}><ChevronLeft className="size-6" aria-hidden /></button>
          <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center">
            {slides.map((_, index) => (
              <button key={index} type="button" aria-label={`اسلاید ${faNumber(index + 1)}`} aria-current={index === current ? 'true' : undefined} onClick={() => go(index)} className="inline-flex size-11 items-center justify-center">
                <span className={`block size-2.5 rounded-full ${index === current ? 'bg-white' : 'bg-white/50'}`} />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

export function HomeBanner({ image, mobileImage, href, external }: { image: SitePageImage; mobileImage: SitePageImage | null; href: string; external: boolean }) {
  const picture = <WideImage image={image} mobile={mobileImage} eager={false} />;
  return (
    <section className="mx-auto max-w-7xl px-4 pt-10 lg:px-8 lg:pt-16" data-home-part="banner">
      <div className="overflow-hidden rounded-surface border border-border">
        {href ? <SlideLink slide={{ href, external }} className="block">{picture}</SlideLink> : picture}
      </div>
    </section>
  );
}
