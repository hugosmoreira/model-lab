#define _GNU_SOURCE
#include <dlfcn.h>
#include <expat.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

int main(int argc, char **argv) {
  Dl_info info;
  if (!dladdr((void *)XML_ExpatVersion, &info)) return 1;
  printf("XML_ExpatVersion=%s resolved=%s\n", XML_ExpatVersion(), info.dli_fname);
  if (strcmp(XML_ExpatVersion(), argc > 1 ? argv[1] : "expat_2.8.4")) return 2;
  const char *normal="<x:xmpmeta xmlns:x='adobe:ns:meta/'><title>normal &amp; valid</title></x:xmpmeta>";
  XML_Parser parser=XML_ParserCreateNS(NULL, ':');
  if (!parser) return 3;
  int ok=XML_Parse(parser, normal, (int)strlen(normal), 1)==XML_STATUS_OK;
  XML_ParserFree(parser);
  if (!ok) return 4;
  parser=XML_ParserCreate(NULL);
  const char *invalid="<x><mismatch></x>";
  ok=XML_Parse(parser, invalid, (int)strlen(invalid), 1)==XML_STATUS_ERROR;
  XML_ParserFree(parser);
  if (!ok) return 5;
  puts("Normal XML accepted; malformed XML rejected.");
  /* Bounded adaptation of upstream PR 1321's ATTLIST normalization fixture. */
  for (int n=5000; n<=40000; n*=2) {
    char *doc=malloc((size_t)n*80+128), *p=doc;
    if (!doc) return 6;
    p+=sprintf(p, "<!DOCTYPE e [\n");
    for (int i=0;i<n;i++) p+=sprintf(p,"<!ATTLIST e a%d NMTOKEN \"x\">\n",i);
    p+=sprintf(p,"]>\n<e ");
    for (int i=0;i<n;i++) p+=sprintf(p,"a%d=\" v \" ",i);
    p+=sprintf(p,"/>");
    parser=XML_ParserCreate(NULL);
    clock_t begin=clock();
    ok=XML_Parse(parser, doc, (int)(p-doc), 1)==XML_STATUS_OK;
    double elapsed=(double)(clock()-begin)/CLOCKS_PER_SEC;
    printf("Upstream PR1321 fixture attributes=%d bytes=%ld cpu_seconds=%.6f parse_ok=%d\n",n,(long)(p-doc),elapsed,ok);
    XML_ParserFree(parser);
    free(doc);
    if (!ok) return 7;
  }
  return 0;
}
