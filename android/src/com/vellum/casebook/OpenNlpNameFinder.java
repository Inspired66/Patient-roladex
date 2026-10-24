package com.vellum.casebook;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import opennlp.tools.namefind.NameFinderME;
import opennlp.tools.namefind.TokenNameFinderModel;
import opennlp.tools.tokenize.SimpleTokenizer;
import opennlp.tools.util.Span;

/** OpenNLP person entity recognition; table association remains outside the model. */
final class OpenNlpNameFinder {
  private static final String DOCUMENT_BUILDER_FACTORY =
      "org.apache.xerces.jaxp.DocumentBuilderFactoryImpl";
  private final NameFinderME nameFinder;

  OpenNlpNameFinder(InputStream modelStream) throws IOException {
    if (modelStream == null) throw new IOException("The bundled person-name model is missing.");
    try {
      System.setProperty(
          "javax.xml.parsers.DocumentBuilderFactory", DOCUMENT_BUILDER_FACTORY);
      nameFinder = new NameFinderME(new TokenNameFinderModel(modelStream));
    } finally {
      modelStream.close();
    }
  }

  List<String> find(String text) {
    String[] tokens = SimpleTokenizer.INSTANCE.tokenize(text == null ? "" : text);
    List<String> names = new ArrayList<>();
    try {
      Span[] spans = nameFinder.find(tokens);
      for (Span span : spans) {
        StringBuilder name = new StringBuilder();
        for (int index = span.getStart(); index < span.getEnd(); index++) {
          if (name.length() > 0 && !tokens[index].matches("^[,.'-]$")) name.append(' ');
          name.append(tokens[index]);
        }
        String value = name.toString().replaceAll("\\s+([,.'-])", "$1").trim();
        if (!value.isEmpty()) names.add(value);
      }
    } finally {
      nameFinder.clearAdaptiveData();
    }
    return names;
  }
}
