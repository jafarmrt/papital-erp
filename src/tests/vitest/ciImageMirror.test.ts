// @vitest-environment node
/**
 * v10.0.38 (TD-1169): CI pulls its images from the Amazon ECR Public mirror of the Docker official images
 * (public.ecr.aws/docker/library), never anonymously from Docker Hub, whose unauthenticated pull limit stopped every
 * database, end-to-end and coverage job before any test ran. The tags stay the same.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const MIRROR = 'public.ecr.aws/docker/library/';
const root = process.cwd();
const workflowDir = path.join(root, '.github/workflows');

describe('ci_images_from_mirror_td_1169', () => {
  it('every service or job image in the workflows comes from the mirror', () => {
    const images: string[] = [];
    for (const file of fs.readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f))) {
      for (const match of fs.readFileSync(path.join(workflowDir, file), 'utf8').matchAll(/^\s*image:\s*(\S+)/gm)) {
        images.push(`${file}: ${match[1]}`);
      }
    }
    expect(images.length).toBeGreaterThan(0);
    expect(images.filter((line) => !line.split(': ')[1].startsWith(MIRROR))).toEqual([]);
  });

  it('every Dockerfile base image comes from the mirror', () => {
    const bases = [...fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8').matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
    expect(bases.length).toBeGreaterThan(0);
    expect(bases.filter((image) => !image.startsWith(MIRROR))).toEqual([]);
  });
});
