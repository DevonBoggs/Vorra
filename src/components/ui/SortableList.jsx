// Generic sortable list using @dnd-kit
// Used by DailyPage for task reordering, and potentially by CoursePlanner for course reordering

import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Restrict transforms to vertical axis only (no horizontal drift while dragging)
const restrictToVerticalAxis = ({ transform }) => {
  return {
    ...transform,
    x: 0,
  };
};

// SortableItem wrapper — wraps any child with drag handle
export function SortableItem({ id, children, dragHandleStyle, handleColor }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : null),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative',
    zIndex: isDragging ? 10 : 'auto',
  };

  const draggingStyle = isDragging ? {
    boxShadow: '0 8px 24px rgba(0,0,0,.18)',
    transform: `${CSS.Transform.toString(transform ? { ...transform, x: 0 } : null)} rotate(1.5deg)`,
    transition,
  } : {};

  return (
    <div ref={setNodeRef} style={{ ...style, ...draggingStyle, display: 'flex', alignItems: 'stretch' }}>
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 6px',
          flexShrink: 0,
          color: handleColor || '#666',
          fontSize: 14,
          userSelect: 'none',
          touchAction: 'none',
          ...dragHandleStyle,
        }}
        title="Drag to reorder"
      >
        ⠿
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

// SortableList container
export function SortableList({ items, onReorder, renderItem, keyExtractor, style }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      const oldIndex = items.findIndex(item => keyExtractor(item) === active.id);
      const newIndex = items.findIndex(item => keyExtractor(item) === over.id);
      onReorder(arrayMove(items, oldIndex, newIndex));
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToVerticalAxis]}
    >
      <SortableContext
        items={items.map(keyExtractor)}
        strategy={verticalListSortingStrategy}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, ...style }}>
          {items.map((item, index) => renderItem(item, index))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export { arrayMove };
