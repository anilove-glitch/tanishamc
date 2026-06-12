import fs from 'fs';
import path from 'path';

const DIR = 'src/roomallocation';

const replacements = [
  // Uncommon JS variable names (mostly DB tables)
  { regex: /\bhousing_groups\b/g, replace: 'housing_group' },
  { regex: /\bgroup_requests\b/g, replace: 'group_request' },
  { regex: /\ballocation_submissions\b/g, replace: 'allocation_submission' },
  { regex: /\bsubmission_preferences\b/g, replace: 'submission_preference' },
  { regex: /\broom_assignments\b/g, replace: 'room_assignment' },

  // SQL contexts for common JS variable names
  { regex: /\bFROM\s+students\b/gi, replace: 'FROM student' },
  { regex: /\bJOIN\s+students\b/gi, replace: 'JOIN student' },
  { regex: /\bUPDATE\s+students\b/gi, replace: 'UPDATE student' },
  { regex: /\bINTO\s+students\b/gi, replace: 'INTO student' },
  { regex: /\bstudents\s+s\b/g, replace: 'student s' },
  { regex: /\bstudents\./g, replace: 'student.' },
  
  { regex: /\bFROM\s+rooms\b/gi, replace: 'FROM room' },
  { regex: /\bJOIN\s+rooms\b/gi, replace: 'JOIN room' },
  { regex: /\bUPDATE\s+rooms\b/gi, replace: 'UPDATE room' },
  { regex: /\bINTO\s+rooms\b/gi, replace: 'INTO room' },
  { regex: /\brooms\s+r\b/g, replace: 'room r' },
  { regex: /\brooms\./g, replace: 'room.' },

  { regex: /\bFROM\s+hostels\b/gi, replace: 'FROM hostel' },
  { regex: /\bJOIN\s+hostels\b/gi, replace: 'JOIN hostel' },
  { regex: /\bUPDATE\s+hostels\b/gi, replace: 'UPDATE hostel' },
  { regex: /\bINTO\s+hostels\b/gi, replace: 'INTO hostel' },
  { regex: /\bhostels\s+h\b/g, replace: 'hostel h' },
  { regex: /\bhostels\./g, replace: 'hostel.' },

  { regex: /\bFROM\s+batches\b/gi, replace: 'FROM batch' },
  { regex: /\bJOIN\s+batches\b/gi, replace: 'JOIN batch' },
  { regex: /\bUPDATE\s+batches\b/gi, replace: 'UPDATE batch' },
  { regex: /\bINTO\s+batches\b/gi, replace: 'INTO batch' },
  { regex: /\bbatches\s+b\b/g, replace: 'batch b' },
  { regex: /\bbatches\./g, replace: 'batch.' }
];

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath);
    } else if (fullPath.endsWith('.js') || fullPath.endsWith('.sql')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let originalContent = content;
      
      for (const { regex, replace } of replacements) {
        content = content.replace(regex, replace);
      }
      
      // Special case: students.map or similar JS methods might get caught by \bstudents\.
      // But let's assume we won't see JS variables named `students` calling JS properties exactly matched as SQL aliases if we are careful. Wait, `students.map` would become `student.map`. Let's revert `student.map`, `student.length`, `student.find`, `student.filter`, `student.forEach`, `student.push`.
      content = content.replace(/\bstudent\.(map|length|find|filter|forEach|push|reduce)\b/g, 'students.$1');
      content = content.replace(/\broom\.(map|length|find|filter|forEach|push|reduce)\b/g, 'rooms.$1');
      content = content.replace(/\bhostel\.(map|length|find|filter|forEach|push|reduce)\b/g, 'hostels.$1');
      content = content.replace(/\bbatch\.(map|length|find|filter|forEach|push|reduce)\b/g, 'batches.$1');
      
      if (content !== originalContent) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`Modified: ${fullPath}`);
      }
    }
  }
}

walk(DIR);
console.log('Done.');
