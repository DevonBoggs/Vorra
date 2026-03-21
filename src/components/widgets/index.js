// Widget Registry — maps widget IDs to metadata and components
import { TaskWidget } from './TaskWidget.jsx';
import { StreakWidget } from './StreakWidget.jsx';
import { ProgressWidget } from './ProgressWidget.jsx';
import { TimerWidget } from './TimerWidget.jsx';
import { UpcomingWidget } from './UpcomingWidget.jsx';
import { CoursesWidget } from './CoursesWidget.jsx';

export const WIDGET_REGISTRY = {
  'tasks':    { id: 'tasks',    name: 'Today\'s Tasks',    icon: 'List',     component: TaskWidget,     defaultOn: true },
  'streak':   { id: 'streak',   name: 'Study Streak',      icon: 'IcFire',   component: StreakWidget,   defaultOn: true },
  'progress': { id: 'progress', name: 'Degree Progress',   icon: 'Grad',     component: ProgressWidget, defaultOn: true },
  'timer':    { id: 'timer',    name: 'Study Timer',       icon: 'Clock',    component: TimerWidget,    defaultOn: true },
  'upcoming': { id: 'upcoming', name: 'Upcoming Tasks',    icon: 'Cal',      component: UpcomingWidget, defaultOn: false },
  'courses':  { id: 'courses',  name: 'Active Courses',    icon: 'Edit',     component: CoursesWidget,  defaultOn: false },
};

export const DEFAULT_WIDGETS = Object.entries(WIDGET_REGISTRY)
  .filter(([_, w]) => w.defaultOn)
  .map(([id]) => id);
