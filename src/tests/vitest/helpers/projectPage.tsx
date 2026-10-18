import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryWrapper } from './queryWrapper';
import ProjectDetailPage from '../../../pages/ProjectDetailPage';

/** the address the page is on, so a test can read where a click took it */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

/** v10.2.1 (10.2 package 2): a production project's page at its own address, as the router mounts it */
export function renderProjectPage(path = '/projects/7') {
  return render(
    <QueryWrapper>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projects/:projectId/:tab?" element={<ProjectDetailPage />} />
          <Route path="/projects" element={<p>فهرست پروژه‌ها</p>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryWrapper>,
  );
}
