# CourseForge – XML Schema (Conceptual)

> Note: This is a conceptual schema to guide implementation and AI/game consumption.

## 1. Root element

```xml
<curriculum>
  <metadata>...</metadata>
  <textbook>...</textbook>
</curriculum># CourseForge – XML Schema (Safe Copy Version)

This document defines the canonical XML export format used by CourseForge.
All XML examples are escaped using &lt; and &gt; so they cannot be interpreted
as HTML by GitHub, VS Code, or browsers.

----------------------------------------------------------------------
1. ROOT STRUCTURE
----------------------------------------------------------------------

Example:

&lt;curriculum&gt;
  &lt;metadata&gt;
    &lt;generatedBy&gt;CourseForge&lt;/generatedBy&gt;
    &lt;generatedAt&gt;2025-03-10T12:00:00Z&lt;/generatedAt&gt;
    &lt;version&gt;1.0.0&lt;/version&gt;
  &lt;/metadata&gt;

  &lt;textbook id="tb1"&gt;
    &lt;!-- textbook content --&gt;
  &lt;/textbook&gt;
&lt;/curriculum&gt;

----------------------------------------------------------------------
2. TEXTBOOK ELEMENT
----------------------------------------------------------------------

&lt;textbook id="tb1"&gt;
  &lt;title&gt;Physics: Principles and Problems&lt;/title&gt;
  &lt;grade&gt;11&lt;/grade&gt;
  &lt;subject&gt;Physics&lt;/subject&gt;
  &lt;edition&gt;2023&lt;/edition&gt;
  &lt;publicationYear&gt;2023&lt;/publicationYear&gt;
  &lt;platformUrl&gt;https://example.com&lt;/platformUrl&gt;

  &lt;chapters&gt;
    &lt;!-- chapter elements --&gt;
  &lt;/chapters&gt;
&lt;/textbook&gt;

----------------------------------------------------------------------
3. CHAPTER ELEMENT
----------------------------------------------------------------------

&lt;chapter id="ch1" index="1"&gt;
  &lt;name&gt;Linear Motion&lt;/name&gt;
  &lt;description&gt;Introduction to one-dimensional motion.&lt;/description&gt;

  &lt;sections&gt;
    &lt;!-- section elements --&gt;
  &lt;/sections&gt;
&lt;/chapter&gt;

----------------------------------------------------------------------
4. SECTION ELEMENT
----------------------------------------------------------------------

&lt;section id="sec1" index="1"&gt;
  &lt;title&gt;Displacement and Distance&lt;/title&gt;
  &lt;notes&gt;Optional teacher notes.&lt;/notes&gt;

  &lt;concepts&gt;
    &lt;!-- concept elements --&gt;
  &lt;/concepts&gt;

  &lt;equations&gt;
    &lt;!-- equation elements --&gt;
  &lt;/equations&gt;

  &lt;vocab&gt;
    &lt;!-- vocab term elements --&gt;
  &lt;/vocab&gt;

  &lt;keyIdeas&gt;
    &lt;!-- key idea elements --&gt;
  &lt;/keyIdeas&gt;
&lt;/section&gt;

----------------------------------------------------------------------
5. CONCEPTS
----------------------------------------------------------------------

&lt;concepts&gt;
  &lt;concept id="c1"&gt;
    &lt;name&gt;Displacement vs Distance&lt;/name&gt;
    &lt;explanation&gt;Displacement is a vector; distance is scalar.&lt;/explanation&gt;
  &lt;/concept&gt;
&lt;/concepts&gt;

----------------------------------------------------------------------
6. EQUATIONS
----------------------------------------------------------------------

&lt;equations&gt;
  &lt;equation id="e1"&gt;
    &lt;name&gt;Velocity&lt;/name&gt;
    &lt;latex&gt;v = d/t&lt;/latex&gt;
    &lt;description&gt;Average velocity equals displacement over time.&lt;/description&gt;
  &lt;/equation&gt;
&lt;/equations&gt;

----------------------------------------------------------------------
7. VOCAB TERMS
----------------------------------------------------------------------

&lt;vocab&gt;
  &lt;term id="v1"&gt;
    &lt;word&gt;Displacement&lt;/word&gt;
    &lt;definition&gt;The change in position of an object.&lt;/definition&gt;

    &lt;altDefinitions&gt;
      &lt;alt&gt;How far out of place an object is.&lt;/alt&gt;
      &lt;alt&gt;A vector from initial to final position.&lt;/alt&gt;
    &lt;/altDefinitions&gt;
  &lt;/term&gt;
&lt;/vocab&gt;

----------------------------------------------------------------------
8. KEY IDEAS
----------------------------------------------------------------------

&lt;keyIdeas&gt;
  &lt;keyIdea id="k1"&gt;
    &lt;text&gt;Velocity has direction; speed does not.&lt;/text&gt;
  &lt;/keyIdea&gt;
&lt;/keyIdeas&gt;

----------------------------------------------------------------------
9. NOTES
----------------------------------------------------------------------

- All tags are escaped using &amp;lt; and &amp;gt;.
- This ensures the schema is safe to copy/paste in any environment.
- The actual XML export will use real &lt; and &gt; characters.
